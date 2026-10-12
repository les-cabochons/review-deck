import { existsSync, readdirSync, readFileSync } from "node:fs";
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
