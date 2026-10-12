import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FileProvider, Side } from "../core/types.js";
import type { PrInput } from "../pipeline.js";

export const ROOT = resolve(import.meta.dirname, "..", "..");
export const FIXTURES = join(ROOT, "fixtures");
const BASE = join(FIXTURES, "sample-repo");
const PRS = join(FIXTURES, "prs");

export interface TruthGroup {
  id: string;
  title: string;
  why: string;
  mechanical: boolean;
  hunks: string[];
}

export function listPrIds(): string[] {
  return readdirSync(PRS)
    .filter((d) => existsSync(join(PRS, d, "diff.patch")))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Pre-image = sample-repo; post-image = the PR overlay, falling back to the base for untouched content (pure renames). */
export function loadPr(id: string): PrInput & { id: string } {
  const dir = join(PRS, id);
  const spec = JSON.parse(readFileSync(join(dir, "pr.json"), "utf8")) as { title: string; description: string; renames: { from: string; to: string }[] };
  const renamedFrom = new Map(spec.renames.map((r) => [r.to, r.from]));
  const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);
  const files: FileProvider = {
    async get(path: string, side: Side) {
      if (side === "old") return read(join(BASE, path));
      return read(join(dir, "files", path)) ?? read(join(BASE, renamedFrom.get(path) ?? path));
    },
  };
  return { id, title: spec.title, description: spec.description, diff: readFileSync(join(dir, "diff.patch"), "utf8"), files };
}

export function loadTruth(id: string): TruthGroup[] {
  return (JSON.parse(readFileSync(join(PRS, id, "truth.json"), "utf8")) as { groups: TruthGroup[] }).groups;
}

// ---- Real PRs from public repositories (fixtures/real/<id>) ----

const REAL = join(FIXTURES, "real");
export const REPOS = join(ROOT, ".cache", "repos");

interface RealPrSpec {
  id: string;
  repo: string;
  url: string;
  commit: string;
  title: string;
  description: string;
}

export function listRealPrIds(): string[] {
  return existsSync(REAL) ? readdirSync(REAL).filter((d) => existsSync(join(REAL, d, "pr.json"))).sort() : [];
}

/** Ensures a blobless clone of the PR's repository exists under .cache/repos and has the commit. Nothing in it is run. */
export function ensureRealRepo(id: string): { spec: RealPrSpec; dir: string } {
  const spec = JSON.parse(readFileSync(join(REAL, id, "pr.json"), "utf8")) as RealPrSpec;
  const dir = join(REPOS, spec.repo.replace(/\.git$/, "").split("/").pop()!);
  if (!existsSync(dir)) {
    mkdirSync(REPOS, { recursive: true });
    console.error(`cloning ${spec.repo} (blobless) into ${dir} ...`);
    execFileSync("git", ["clone", "-q", "--filter=blob:none", "--no-checkout", spec.repo, dir], { stdio: "inherit" });
  }
  try {
    execFileSync("git", ["-C", dir, "cat-file", "-e", `${spec.commit}^{commit}`]);
  } catch {
    execFileSync("git", ["-C", dir, "fetch", "-q", "origin", spec.commit], { stdio: "inherit" });
  }
  return { spec, dir };
}

/**
 * Real-PR truth may list `files` (exact paths, or prefixes ending in "/") instead of hunk IDs.
 * Expands them against the PR's hunks; every hunk must land in exactly one group.
 */
export function loadRealTruth(id: string, hunkIds: string[]): TruthGroup[] {
  const raw = JSON.parse(readFileSync(join(REAL, id, "truth.json"), "utf8")) as {
    groups: (Omit<TruthGroup, "hunks"> & { hunks?: string[]; files?: string[] })[];
  };
  const pathOf = (h: string) => h.slice(0, h.lastIndexOf("#"));
  const matches = (path: string, pattern: string) => (pattern.endsWith("/") ? path.startsWith(pattern) : path === pattern);
  const groups = raw.groups.map((g) => ({
    ...g,
    hunks: g.hunks ?? hunkIds.filter((h) => g.files!.some((f) => matches(pathOf(h), f))),
  }));
  const seen = new Map<string, string>();
  for (const g of groups) {
    for (const h of g.hunks) {
      if (seen.has(h)) throw new Error(`${id}: ${h} is in both ${seen.get(h)} and ${g.id}`);
      seen.set(h, g.id);
    }
  }
  const missing = hunkIds.filter((h) => !seen.has(h));
  if (missing.length) throw new Error(`${id}: hunks not in any truth group: ${missing.join(", ")}`);
  return groups;
}
