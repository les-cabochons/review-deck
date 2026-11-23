// Fixed rules over a hunk's added lines: likely secrets, and database migrations that can lose data or break a
// deploy. They need no backend and no model, so every pull request gets them. A rule reports where it hit and why it
// matters, never the matched text: findings are saved with the guide, which every reader of the PR can open.
//
// Added to the patterns credited below: the Azure keys, EF Core, T-SQL, statements that span lines, rollback methods
// found through the file's declarations, and the checks that skip tests and name-like values.

/*!
 * The secret patterns and the SQL, Rails, Knex, Django and Laravel migration patterns in src/analyze/safety.ts are
 * adapted from reflektor (https://github.com/bashovski/reflektor), skill/scripts/collect.mts.
 *
 * MIT License
 *
 * Copyright (c) 2026 Anur Bašić
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { isTestPath } from "../core/paths.js";
import type { FileDiff, Hunk, MechanicalInfo, SafetyFinding } from "../core/types.js";
import type { Decl } from "../parse/symbols.js";

type Severity = SafetyFinding["severity"];

/** Lines longer than this are minified or embedded data: not scanned, to keep the rules linear on huge files. */
const MAX_LINE = 4000;

// ------------------------------------------------------------------ secrets

/**
 * `value` is the capture group holding the secret, for the placeholder check. `random`: the value must also hold a
 * digit, as generated secrets nearly always do, so `accessToken: "saved-access-token"` (a name, not a token) passes.
 */
const SECRET_RULES: { rule: string; severity: Severity; re: RegExp; value?: number; random?: true }[] = [
  { rule: "AWS access key", severity: "high", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { rule: "Private key", severity: "high", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/ },
  { rule: "GitHub token", severity: "high", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/ },
  { rule: "GitLab token", severity: "high", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { rule: "Slack token", severity: "high", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { rule: "Stripe live key", severity: "high", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/ },
  { rule: "Google API key", severity: "high", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { rule: "AI API key", severity: "high", re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { rule: "JSON Web Token", severity: "high", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  // Storage, Service Bus, Event Hubs and IoT Hub connection strings.
  { rule: "Azure access key", severity: "high", re: /\b(?:AccountKey|SharedAccessKey)=([A-Za-z0-9+/]{30,}={0,2})/, value: 1 },
  {
    rule: "Password or secret in code",
    severity: "medium",
    re: /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["']([^"'\s$<>{}]{8,})["']/i,
    value: 1,
    random: true,
  },
  { rule: "Password in a connection URL", severity: "medium", re: /\b[a-z][a-z0-9+.-]*:\/\/([^\s:@/]+):([^\s:@/]{3,})@/i, value: 2 },
];

/** A line without any of these can't match a secret rule; one cheap test instead of a dozen per line. */
const SECRET_HINT = /AKIA|ASIA|PRIVATE KEY|gh[pousr]_|github_pat_|glpat-|xox[abposr]-|_live_|AIza|sk-|eyJ|AccountKey=|SharedAccessKey=|passw|pwd|secret|key|token|:\/\//i;

/** Values that are obviously not real, so `postgres://app:app@db` in a dev setup isn't flagged. */
const PLACEHOLDER = /^(password|passwd|secret|changeme|change-me|example|sample|test|testing|dev|local|postgres|root|admin|user|pass|x+|\*+|\.+)$/i;
/** The key every Azurite and storage emulator install shares; it opens nothing real. */
const AZURITE_KEY = "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";

/** Example files, docs and fixtures hold sample values on purpose; so do tests, wherever they live (isTestPath). */
const NOT_REAL = /(^|\/)(\.env\.(example|sample|template|dist)|[^/]*\.(example|sample|template)(\.[^/]+)?|[^/]*\.md)$|(^|\/)(tests?|__tests__|spec|fixtures?|testdata)\//i;

const SECRET_FILES: { re: RegExp; rule: string; message: string }[] = [
  {
    re: /(^|\/)\.env(\.(local|prod|production|staging|dev|development))?$/i,
    rule: "Env file committed",
    message: "Env files usually hold real secrets. Keep them out of git and add them to .gitignore.",
  },
  {
    re: /\.(pem|key|p12|pfx|keystore|jks)$|(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i,
    rule: "Key file committed",
    message: "Private key files must not be in git: anyone who can read the repository can use the key.",
  },
];

const SECRET_MESSAGE = "Looks like a real credential. If it is one, remove it, rotate it, and load it from the environment or a vault.";

// ------------------------------------------------------------------ migrations

const MIGRATION_PATH = /(^|\/)(migrations?|migrate|alembic|flyway|liquibase)(\/|$)|\.sql$|(^|\/)schema\.(rb|sql|prisma)$/i;
/** A whole file that only runs on a rollback: golang-migrate's .down.sql, Diesel's down.sql, Flyway's undo files. */
const ROLLBACK_FILE = /(^|\/)(down\.sql|[^/]+\.down\.sql|U\d[\w.]*__[^/]*\.sql)$/i;
/** Marks the up or down section of a file that holds both (dbmate, goose, sql-migrate). */
const SECTION_MARK = /^\s*--\s*(?:migrate:(up|down)|\+(?:goose|migrate)\s+(up|down))\b/i;
/** The rollback method of a migration class or module: EF Core and Laravel `Down`, Rails and Knex `down`, Alembic `downgrade`. */
const ROLLBACK_DECL = /^(down|downgrade)$/i;

/**
 * `test` gets the added line and `statement`: that line and the ones after it, up to the line holding a `;` (statementFrom).
 * A rule that reads `statement` cuts it at the `;` itself, since one line can hold several statements.
 */
const MIGRATION_RULES: { rule: string; severity: Severity; message: string; test: (line: string, statement: string) => boolean }[] = [
  {
    rule: "Drops a table",
    severity: "high",
    message: "Its data is gone, and code that still reads the table breaks during the deploy.",
    test: (l) => /\bDROP\s+TABLE\b|\bdrop_table\b|\.dropTable(IfExists)?\s*\(|\bDeleteModel\s*\(|Schema::drop/i.test(l),
  },
  {
    rule: "Drops a column",
    severity: "high",
    message: "Its data is gone, and the old code that runs during the deploy breaks.",
    test: (l) => /\bDROP\s+COLUMN\b|\bremove_column\b|\.dropColumn\s*\(|\bRemoveField\s*\(/i.test(l),
  },
  {
    rule: "Empties a table",
    severity: "high",
    message: "TRUNCATE deletes every row in the table.",
    test: (l) => /\bTRUNCATE\s+TABLE\b|^\s*TRUNCATE\s+[\w."`[]/i.test(l),
  },
  {
    rule: "NOT NULL column without a default",
    severity: "high",
    message: "Adding it fails on a table that already has rows.",
    // EF Core isn't matched on purpose: it writes a defaultValue for a required column added to an existing table.
    test: (l) =>
      (/\bADD\s+(COLUMN\s+)?(IF\s+NOT\s+EXISTS\s+)?\S+\s+\S+.*\bNOT\s+NULL\b/i.test(l) && !/\bDEFAULT\b/i.test(l)) ||
      (/\badd_column\b.*\bnull:\s*false\b/.test(l) && !/\bdefault:/.test(l)),
  },
  {
    rule: "Renames a table or column",
    severity: "medium",
    message: "Code from before the deploy still uses the old name until it is replaced.",
    test: (l) => /\bRENAME\s+(COLUMN\s+\S+\s+)?TO\b|\brename_(column|table)\b|\.rename(Column|Table)\s*\(|\bRename(Field|Model)\s*\(|\bsp_rename\b/i.test(l),
  },
  {
    rule: "Changes a column's type or nullability",
    severity: "medium",
    message: "The database may rewrite and lock the whole table, and the change fails if existing rows don't fit.",
    // `ALTER COLUMN x <type>` is T-SQL; PostgreSQL's harmless forms (defaults, statistics, DROP NOT NULL) are left out.
    test: (l) =>
      /\bALTER\s+COLUMN\s+\S+\s+(?!(?:SET|DROP)\s+DEFAULT\b|DROP\s+NOT\s+NULL\b|SET\s+(?:STATISTICS|STORAGE)\b)\S/i.test(l) ||
      /\bchange_column\b|\bAlterField\s*\(|\.AlterColumn\s*[<(]/.test(l),
  },
  {
    rule: "Writes rows without WHERE",
    severity: "medium",
    message: "It changes or deletes every row of the table.",
    // Each write on the line is checked up to its own `;`, so a later statement's WHERE doesn't cover an earlier one.
    test: (l, statement) =>
      [...l.matchAll(/\b(?:DELETE\s+FROM|UPDATE\s+\S+\s+SET)\b/gi)].some((m) => !/\bWHERE\b/i.test(statement.slice(m.index).split(";")[0])),
  },
];

/** How many lines after a `DELETE` or `UPDATE` are read looking for its `WHERE`, when no `;` ends it sooner. */
const STATEMENT_LINES = 12;

// ------------------------------------------------------------------ entry point

/**
 * The safety rules for one file, as a function to call per hunk. `newContent` and `decls` are the file's new side
 * (null and empty when it wasn't read or parsed); they tell rollback code apart, which the migration rules skip
 * because it runs only when someone rolls a migration back.
 *
 * Lockfiles and generated files aren't scanned: nobody wrote them, and their hashes look like keys.
 */
export function safetyRules(file: FileDiff, newContent: string | null, decls: readonly Decl[]): (hunk: Hunk, mechanical: MechanicalInfo | null) => SafetyFinding[] {
  const scanSecrets = !NOT_REAL.test(file.path) && !isTestPath(file.path);
  const isMigration = MIGRATION_PATH.test(file.path) && !ROLLBACK_FILE.test(file.path);
  const rollback = isMigration ? rollbackLines(newContent, decls) : new Set<number>();
  const newLines = isMigration ? (newContent?.split("\n") ?? null) : null;
  if (!scanSecrets && !isMigration) return () => [];

  return (hunk, mechanical) => {
    if (mechanical?.kind === "lockfile" || mechanical?.kind === "generated") return [];
    const findings: SafetyFinding[] = [];
    // The file itself is the finding, so it goes on the file's first hunk.
    if (scanSecrets && file.status === "added" && hunk.index === 0) {
      for (const f of SECRET_FILES) if (f.re.test(file.path)) findings.push({ kind: "secret", severity: "high", rule: f.rule, message: f.message, line: null });
    }
    for (const [i, l] of hunk.lines.entries()) {
      if (l.kind !== "add" || l.text.length > MAX_LINE) continue;
      const line = l.newLine ?? null;
      if (scanSecrets && SECRET_HINT.test(l.text)) {
        for (const s of SECRET_RULES) {
          const m = l.text.match(s.re);
          if (!m || (s.value !== undefined && isPlaceholder(m, s.value)) || (s.random && !/\d/.test(m[s.value!]))) continue;
          findings.push({ kind: "secret", severity: s.severity, rule: s.rule, message: SECRET_MESSAGE, line });
        }
      }
      if (isMigration && line !== null && !rollback.has(line)) {
        const statement = statementFrom(newLines, hunk, i, line);
        for (const r of MIGRATION_RULES) {
          if (r.test(l.text, statement)) findings.push({ kind: "migration", severity: r.severity, rule: r.rule, message: r.message, line });
        }
      }
    }
    return findings;
  };
}

function isPlaceholder(m: RegExpMatchArray, group: number): boolean {
  const value = m[group] ?? "";
  // `scheme://app:app@host`: a user name repeated as its password is a dev default.
  return PLACEHOLDER.test(value) || value === AZURITE_KEY || (group === 2 && m[1] === value);
}

/**
 * The new-side text from `line` (line `i` of the hunk) to the line holding the next `;`, at most STATEMENT_LINES
 * lines. Read from the file's new side when it was read, since the statement can run past the hunk's few lines of
 * context; from the hunk otherwise.
 */
function statementFrom(newLines: readonly string[] | null, hunk: Hunk, i: number, line: number): string {
  const texts = newLines
    ? newLines.slice(line - 1, line - 1 + STATEMENT_LINES)
    : hunk.lines.slice(i).filter((l) => l.kind !== "del").slice(0, STATEMENT_LINES).map((l) => l.text);
  const end = texts.findIndex((t) => t.includes(";"));
  return texts.slice(0, end === -1 ? undefined : end + 1).join("\n");
}

/** New-side line numbers (1-based) of a migration file's rollback code: its down section, or its `Down` method. */
function rollbackLines(content: string | null, decls: readonly Decl[]): Set<number> {
  const down = new Set<number>();
  for (const d of decls) {
    if ((d.kind === "method" || d.kind === "function") && ROLLBACK_DECL.test(d.name)) for (let row = d.startRow; row <= d.endRow; row++) down.add(row + 1);
  }
  let inDown = false;
  for (const [i, text] of (content?.split("\n") ?? []).entries()) {
    const mark = text.match(SECTION_MARK);
    if (mark) inDown = (mark[1] ?? mark[2]).toLowerCase() === "down";
    else if (inDown) down.add(i + 1);
  }
  return down;
}
