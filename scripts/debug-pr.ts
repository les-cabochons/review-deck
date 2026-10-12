/**
 * Prints per-hunk facts, strong pairs and resulting groups for one PR; handy while tuning weights.
 *   npx tsx scripts/debug-pr.ts pr2 [--embeddings]
 *   npx tsx scripts/debug-pr.ts --repo ../t3code --commit <sha> [--embeddings] [--quiet]
 */
import { mergeConfig } from "../src/core/config.js";
import { adjustedRandIndex, labelsFromGroups, labelsFromTruth } from "../src/eval/ari.js";
import { TransformersEmbedder } from "../src/node/embedder.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ensureRealRepo, FIXTURES, listRealPrIds, loadPr, loadRealTruth, loadTruth, type TruthGroup } from "../src/node/fixtures.js";
import { parseDiff } from "../src/diff/parse.js";
import { loadGitPr } from "../src/node/git.js";
import { createNodeParsers } from "../src/node/parsers.js";
import { runPipeline } from "../src/pipeline.js";

const id = process.argv[2] ?? "pr1";
const semantic = process.argv.includes("--embeddings");
const overrideArg = process.argv.indexOf("--config");
const overrides = overrideArg > 0 ? JSON.parse(process.argv[overrideArg + 1]) : {};
const config = mergeConfig({ ...overrides, semantic: { ...overrides.semantic, enabled: semantic } });
const repoArg = process.argv.indexOf("--repo");
const commitArg = process.argv.indexOf("--commit");
const quiet = process.argv.includes("--quiet");
const isReal = listRealPrIds().includes(id);
const real = isReal ? ensureRealRepo(id) : null;
const input = real
  ? await loadGitPr(real.dir, `${real.spec.commit}^`, real.spec.commit, real.spec)
  : repoArg > 0
    ? await loadGitPr(process.argv[repoArg + 1], `${process.argv[commitArg + 1]}^`, process.argv[commitArg + 1])
    : loadPr(id);
const result = await runPipeline(input, config, {
  parsers: await createNodeParsers(),
  embedder: semantic ? new TransformersEmbedder(config.semantic.model) : null,
});

const truth: TruthGroup[] = isReal
  ? loadRealTruth(id, parseDiff(input.diff).flatMap((f) => f.hunks.map((h) => h.id)))
  : repoArg < 0 && existsSync(join(FIXTURES, "prs", id, "truth.json"))
    ? loadTruth(id)
    : [];
const truthOf = new Map(truth.flatMap((g) => g.hunks.map((h) => [h, g.id] as const)));
console.log(`\n== ${id}: hunks`);
for (const h of quiet ? [] : result.hunks.values()) {
  console.log(
    `${h.hunk.id.padEnd(34)} [${truthOf.get(h.hunk.id)}] sym=${h.symbol} ${h.mechanical ? `MECH(${h.mechanical.kind})` : ""}${h.commentOnly ? " COMMENT" : ""}`,
  );
  console.log(`   def={${[...h.defines].join(",")}} imp={${[...h.impacts].join(",")}} ref={${[...h.references].join(",")}}`);
}
console.log(`\n== pairs (weight >= ${config.minEdgeWeight})`);
for (const p of [...result.pairs].sort((a, b) => b.weight - a.weight)) {
  if (p.weight < config.minEdgeWeight || quiet) continue;
  const same = truthOf.get(p.a) === truthOf.get(p.b) ? " " : "✗";
  const sig = Object.entries(p.signals)
    .map(([k, v]) => `${k}=${v!.score.toFixed(2)}`)
    .join(" ");
  console.log(`${same} ${p.weight.toFixed(2)} ${p.a} ~ ${p.b}  ${sig}  | ${Object.values(p.signals).flatMap((s) => s!.evidence).join("; ").slice(0, 120)}`);
}
console.log("\n== merges");
for (const m of result.merges) console.log(`  ${m.from} uses ${m.symbol} introduced by ${m.into}`);
console.log("\n== groups");
for (const g of result.groups) {
  const mix = new Map<string, number>();
  for (const h of g.hunkIds) mix.set(truthOf.get(h) ?? "?", (mix.get(truthOf.get(h) ?? "?") ?? 0) + 1);
  console.log(`[${g.id}] ${g.title}  {${[...mix].map(([k, v]) => `${k}:${v}`).join(" ")}}`);
  if (quiet) continue;
  console.log(`   ${g.rationale}`);
  for (const h of g.hunkIds) console.log(`     ${h}  (truth: ${truthOf.get(h)})`);
}
if (truth.length) console.log(`\nARI = ${adjustedRandIndex(labelsFromTruth(truth), labelsFromGroups(result.groups)).toFixed(3)}`);
