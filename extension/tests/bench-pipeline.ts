/**
 * Times the semantic pipeline on an extension/dev-data snapshot and prints a fingerprint of its output
 * (groups, every pair score, per-hunk symbols). Performance changes must leave the fingerprint unchanged.
 *
 *   npm run bench -- [snapshot=t3code-huge]   (build t3code-huge with scripts/build-huge-mock.ts)
 */
import { readFileSync } from "node:fs";
import { mergeConfig } from "../../src/core/config.js";
import { runPipeline } from "../../src/pipeline.js";
import { createNodeParsers } from "../../src/node/parsers.js";
import { MockPrSource } from "../src/data/mockSource.js";
import { buildDiff, type FileContents } from "../src/review/analysis.js";

const name = process.argv[2] ?? "t3code-huge";
const source = new MockPrSource(JSON.parse(readFileSync(`extension/dev-data/${name}.json`, "utf8")));
const data = await source.load();
const changes = await source.getChanges(data.iterations.at(-1)!.id, 0);
const contents = new Map<string, FileContents>();
for (const c of changes) {
  const old = c.oldObjectId ? await source.getBlob(c.oldObjectId) : null;
  const nu = c.newObjectId ? await source.getBlob(c.newObjectId) : null;
  contents.set(c.path, { old, new: nu, binary: false, tooLarge: false });
}
const texts = new Map<string, string | null>();
for (const c of changes) { texts.set(`new:${c.path}`, contents.get(c.path)!.new); texts.set(`old:${c.originalPath ?? c.path}`, contents.get(c.path)!.old); }
let t = performance.now();
const diff = buildDiff(changes, contents);
console.log("diff ms", Math.round(performance.now() - t));
const parsers = await createNodeParsers();
t = performance.now();
const result = await runPipeline({ title: "", description: "", diff, files: { get: async (p, s) => texts.get(`${s}:${p}`) ?? null } }, mergeConfig({ semantic: { enabled: false } }), { parsers });
console.log("pipeline ms", Math.round(performance.now() - t), result.timings, "groups", result.groups.length, "pairs", result.pairs.length);
// Fingerprint of everything the pipeline decides, to prove optimizations change nothing.
import { createHash } from "node:crypto";
const fp = createHash("sha256")
  .update(JSON.stringify(result.groups))
  .update(JSON.stringify(result.pairs.map((p) => [p.a, p.b, p.weight, p.signals])))
  .update(JSON.stringify([...result.hunks.values()].map((h) => [h.hunk.id, h.symbol, [...h.defines], [...h.references], [...h.tokens]])))
  .digest("hex").slice(0, 16);
console.log("fingerprint", fp);
