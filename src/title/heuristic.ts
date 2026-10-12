import { basename, dirname } from "../core/paths.js";
import type { HunkInfo, SignalName } from "../core/types.js";
import type { GroupTitle, TitleInput, Titler } from "./types.js";

/** Rule-based titles from the group's dominant symbol, change pattern and common directory. */
export class HeuristicTitler implements Titler {
  readonly name = "heuristic";

  async title(inputs: TitleInput[]): Promise<GroupTitle[]> {
    return inputs.map(describeGroup);
  }
}

export function describeGroup({ group, hunks, pairs }: TitleInput): GroupTitle {
  const files = new Set(hunks.map((h) => h.file.path));
  const where = `${hunks.length} hunk${hunks.length === 1 ? "" : "s"} in ${files.size} file${files.size === 1 ? "" : "s"}`;

  if (group.kind === "mechanical") {
    const kinds = countBy(hunks.map((h) => h.mechanical?.kind ?? "other"));
    return {
      title: "Mechanical changes",
      rationale: `Collapsed: ${[...kinds].map(([k, n]) => `${n} ${k}`).join(", ")}. Nothing to review line by line.`,
    };
  }
  if (group.kind === "misc") {
    return { title: "Other changes", rationale: `${where} with no strong link to any other change.` };
  }

  const code = hunks.filter((h) => !h.isTest);
  const scope = commonDir((code.length ? code : hunks).map((h) => h.file.path));
  const suffix = scope.includes("/") ? ` in ${scope}` : "";
  const linkedBy = summarizeLinks(pairs);

  const rename = detectRename(hunks);
  if (rename) {
    return { title: `Rename ${rename.from} → ${rename.to}`, rationale: `Same identifier substitution in ${where}.${linkedBy}` };
  }

  const move = detectMove(hunks);
  if (move) {
    return {
      title: `Move ${move.name} to ${move.to}`,
      rationale: `Removed from ${move.from} and re-added in ${move.to}; ${where} update call sites and tests.${linkedBy}`,
    };
  }

  if (hunks.every((h) => h.commentOnly)) {
    const syms = unique(hunks.map((h) => h.symbol).filter(isSymbol)).slice(0, 3);
    return { title: `Document ${syms.join(", ") || "code"}`, rationale: `Comment-only changes: ${where}.` };
  }

  // Name the group after its hub: the non-test hunk with the most link weight inside the group.
  const pool = code.length ? code : hunks;
  const nameable = (h: HunkInfo) =>
    h.addedDecls.some((q) => !isDataDecl(h, q)) || (isSymbol(h.symbol) && !isDataDecl(h, h.symbol));
  const hub = pickHub(pool.some(nameable) ? pool.filter(nameable) : pool, pairs);
  const hubSymbol = isSymbol(hub.symbol) && !isDataDecl(hub, hub.symbol) ? hub.symbol : null;
  const hubName =
    hub.addedDecls.find((q) => !isDataDecl(hub, q)) ?? hubSymbol ?? (isSymbol(hub.symbol) ? hub.symbol : basename(hub.file.path));
  const verb = hub.addedDecls.includes(hubName) || hub.file.status === "added" ? "Add" : "Update";
  const helpers = (code.length ? code : hunks)
    .flatMap((h) => rankAdded([h], hunks).filter((q) => !isDataDecl(h, q)))
    .filter((q) => q !== hubName && !q.startsWith(`${hubName}.`));
  const extra = helpers.length > 0 ? ` (+ ${helpers.slice(0, 2).map((q) => q.split(".").pop()).join(", ")})` : "";
  const touched = unique((code.length ? code : hunks).map((h) => h.symbol).filter(isSymbol));
  return {
    title: `${verb} ${hubName}${extra}${suffix}`,
    rationale: `Centers on ${hubName}${helpers.length ? `, introducing ${helpers.slice(0, 4).join(", ")}` : ""}; touches ${touched.slice(0, 4).join(", ") || "no named symbols"} (${where}).${linkedBy}`,
  };
}

function pickHub(candidates: HunkInfo[], pairs: TitleInput["pairs"]): HunkInfo {
  const degree = new Map<string, number>();
  for (const p of pairs) {
    degree.set(p.a, (degree.get(p.a) ?? 0) + p.weight);
    degree.set(p.b, (degree.get(p.b) ?? 0) + p.weight);
  }
  return [...candidates].sort((a, b) => (degree.get(b.hunk.id) ?? 0) - (degree.get(a.hunk.id) ?? 0))[0];
}

/** Fields and plain variables (`const log = ...`) make poor group names. */
function isDataDecl(h: HunkInfo, qualified: string): boolean {
  const name = qualified.split(".").pop()!;
  const isMethodOrFn = h.references.has(`.${name}`) || /\(/.test(h.hunk.lines.find((l) => l.kind === "add" && l.text.includes(name))?.text ?? "");
  return /^[A-Z0-9_]+$/.test(name) || (!isMethodOrFn && !/^[A-Z]/.test(name));
}

const isSymbol = (s: string | null): s is string => !!s && !s.startsWith("(") && !/^(describe|it|test)\(/.test(s);

function summarizeLinks(pairs: TitleInput["pairs"]): string {
  const strongest = new Map<SignalName, number>();
  const symbols = new Map<string, number>();
  for (const p of pairs) {
    for (const [name, s] of Object.entries(p.signals) as [SignalName, { score: number; evidence: string[] }][]) {
      if (name === "path" || s.score < 0.3) continue;
      strongest.set(name, (strongest.get(name) ?? 0) + 1);
      if (name === "structural") {
        for (const e of s.evidence) {
          const sym = e.split(" ").pop()!;
          symbols.set(sym, (symbols.get(sym) ?? 0) + 1);
        }
      }
    }
  }
  if (strongest.size === 0) return "";
  const parts = [...strongest].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${c}× ${n}`);
  const top = [...symbols].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s);
  return ` Linked by ${parts.join(", ")}${top.length ? ` (via ${top.join(", ")})` : ""}.`;
}

/** Finds X→Y if most hunks only swap identifier X for Y. */
function detectRename(hunks: HunkInfo[]): { from: string; to: string } | null {
  const votes = new Map<string, number>();
  for (const h of hunks) {
    const del = h.hunk.lines.filter((l) => l.kind === "del").map((l) => l.text);
    const add = h.hunk.lines.filter((l) => l.kind === "add").map((l) => l.text);
    if (del.length === 0 || del.length !== add.length) continue;
    const found = new Set<string>();
    let clean = true;
    for (let i = 0; i < del.length; i++) {
      const removed = multisetDiff(idents(del[i]), idents(add[i]));
      const introduced = multisetDiff(idents(add[i]), idents(del[i]));
      if (removed.length === 0 && introduced.length === 0) continue;
      if (unique(removed).length !== 1 || unique(introduced).length !== 1) {
        clean = false;
        break;
      }
      found.add(`${removed[0]}→${introduced[0]}`);
    }
    if (clean) for (const f of found) votes.set(f, (votes.get(f) ?? 0) + 1);
  }
  const best = [...votes].sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < Math.max(2, Math.ceil(hunks.length * 0.6))) return null;
  const [from, to] = best[0].split("→");
  return { from, to };
}

function detectMove(hunks: HunkInfo[]): { name: string; from: string; to: string } | null {
  for (const h of hunks) {
    for (const removed of h.removedDecls) {
      const name = removed.split(".").pop()!;
      const target = hunks.find((o) => o.file.path !== h.file.path && o.addedDecls.some((q) => q.split(".").pop() === name));
      if (target) return { name, from: h.file.path, to: target.file.path };
    }
  }
  return null;
}

/** Added declarations, most-referenced by the rest of the group first. */
function rankAdded(candidates: HunkInfo[], all: HunkInfo[]): string[] {
  const scored = candidates.flatMap((h) =>
    h.addedDecls.map((q) => {
      const name = q.split(".").pop()!;
      const keys = [name, `.${name}`];
      const uses = all.filter((o) => o !== h && keys.some((k) => o.references.has(k) || o.defines.has(k))).length;
      return { q, uses, depth: q.split(".").length };
    }),
  );
  return unique(scored.sort((a, b) => b.uses - a.uses || a.depth - b.depth).map((s) => s.q));
}

function commonDir(paths: string[]): string {
  const dirs = paths.map((p) => dirname(p).split("/"));
  if (dirs.length === 0) return "";
  const out: string[] = [];
  for (let i = 0; i < dirs[0].length; i++) {
    const seg = dirs[0][i];
    if (dirs.every((d) => d[i] === seg)) out.push(seg);
    else break;
  }
  return out.join("/");
}

function idents(line: string): string[] {
  return line.match(/[A-Za-z_$][\w$]*/g) ?? [];
}

function multisetDiff(a: string[], b: string[]): string[] {
  const counts = countBy(b);
  const out: string[] = [];
  for (const x of a) {
    const c = counts.get(x) ?? 0;
    if (c > 0) counts.set(x, c - 1);
    else out.push(x);
  }
  return out;
}

function countBy(xs: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
