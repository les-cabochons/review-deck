/**
 * Builds the fake PR fixtures.
 *
 * For each fixtures/prs/<id>/ it creates a throwaway git repo from
 * fixtures/sample-repo, applies the PR (renames, deletes, then the `files/`
 * overlay of full post-change files), and writes:
 *   - diff.patch  unified diff (git diff -M) between base and PR
 *   - hunks.json  every hunk ID in the patch with a short preview
 * If truth.json exists, it checks that every hunk is assigned to exactly one group.
 *
 * Hunk IDs are `<path>#<n>`: path is the post-change path (pre-change for
 * deletions), n is the 0-based hunk index within that file. A file change
 * with no hunks (pure rename, mode change) gets a single pseudo-hunk `#0`.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const BASE = join(ROOT, "fixtures", "sample-repo");
const PRS = join(ROOT, "fixtures", "prs");

interface PrSpec {
  id: string;
  title: string;
  description: string;
  renames: { from: string; to: string }[];
  deletes: string[];
}

interface TruthFile {
  groups: { id: string; hunks: string[] }[];
}

interface HunkListing {
  id: string;
  file: string;
  header: string;
  preview: string[];
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

function buildPatch(spec: PrSpec, prDir: string): string {
  const work = mkdtempSync(join(tmpdir(), `review-deck-${spec.id}-`));
  try {
    cpSync(BASE, work, { recursive: true });
    git(work, "init", "-q", "-b", "main");
    git(work, "config", "user.email", "fixtures@example.com");
    git(work, "config", "user.name", "fixtures");
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", "base");
    git(work, "branch", "base");

    for (const { from, to } of spec.renames) git(work, "mv", from, to);
    for (const path of spec.deletes) git(work, "rm", "-q", path);
    const overlay = join(prDir, "files");
    if (existsSync(overlay)) cpSync(overlay, work, { recursive: true });
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", spec.title);

    return git(work, "diff", "-M", "--no-color", "base", "HEAD");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Minimal enumeration of hunks; the real parser lives in the pipeline. */
function listHunks(patch: string): HunkListing[] {
  const out: HunkListing[] = [];
  const fileBlocks = patch.split(/^(?=diff --git )/m).filter((b) => b.startsWith("diff --git "));
  for (const block of fileBlocks) {
    const lines = block.split("\n");
    const [, oldPath, newPath] = /^diff --git a\/(.+) b\/(.+)$/.exec(lines[0])!;
    const deleted = lines.some((l) => l.startsWith("deleted file mode"));
    const file = deleted ? oldPath : newPath;
    let index = 0;
    let current: HunkListing | undefined;
    for (const line of lines) {
      if (line.startsWith("@@")) {
        current = { id: `${file}#${index++}`, file, header: line, preview: [] };
        out.push(current);
      } else if (current && (line.startsWith("+") || line.startsWith("-")) && current.preview.length < 4) {
        current.preview.push(line.length > 100 ? `${line.slice(0, 100)}…` : line);
      }
    }
    if (index === 0) {
      const what = lines.filter((l) => /^(rename|similarity|new file|deleted file|old mode|new mode)/.test(l));
      out.push({ id: `${file}#0`, file, header: "(no hunks)", preview: what });
    }
  }
  return out;
}

function checkTruth(prId: string, truth: TruthFile, hunks: HunkListing[]): string[] {
  const problems: string[] = [];
  const known = new Set(hunks.map((h) => h.id));
  const seen = new Map<string, string>();
  for (const group of truth.groups) {
    for (const id of group.hunks) {
      if (!known.has(id)) problems.push(`${prId}: truth group "${group.id}" lists unknown hunk ${id}`);
      const prev = seen.get(id);
      if (prev) problems.push(`${prId}: hunk ${id} is in both "${prev}" and "${group.id}"`);
      seen.set(id, group.id);
    }
  }
  for (const id of known) if (!seen.has(id)) problems.push(`${prId}: hunk ${id} is not in any truth group`);
  return problems;
}

const problems: string[] = [];
for (const id of readdirSync(PRS).sort()) {
  const prDir = join(PRS, id);
  const spec = JSON.parse(readFileSync(join(prDir, "pr.json"), "utf8")) as PrSpec;
  const patch = buildPatch(spec, prDir);
  writeFileSync(join(prDir, "diff.patch"), patch);
  const hunks = listHunks(patch);
  writeFileSync(join(prDir, "hunks.json"), `${JSON.stringify(hunks, null, 2)}\n`);

  const truthPath = join(prDir, "truth.json");
  let status = "no truth.json yet";
  if (existsSync(truthPath)) {
    const truth = JSON.parse(readFileSync(truthPath, "utf8")) as TruthFile;
    const found = checkTruth(id, truth, hunks);
    problems.push(...found);
    status = found.length === 0 ? `truth OK (${truth.groups.length} groups)` : `truth has ${found.length} problem(s)`;
  }
  const files = new Set(hunks.map((h) => h.file)).size;
  console.log(`${id}: ${files} files, ${hunks.length} hunks, ${status}`);
}

if (problems.length > 0) {
  console.error(`\n${problems.join("\n")}`);
  process.exit(1);
}
