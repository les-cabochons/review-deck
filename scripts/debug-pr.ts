/**
 * Prints per-hunk facts, strong pairs and resulting groups for one PR; handy while tuning weights.
 *   npx tsx scripts/debug-pr.ts pr2 [--embeddings]
 */
import { mergeConfig } from "../src/core/config.js";
import { adjustedRandIndex, labelsFromGroups, labelsFromTruth } from "../src/eval/ari.js";
import { TransformersEmbedder } from "../src/node/embedder.js";
import { loadPr, loadTruth } from "../src/node/fixtures.js";
import { createNodeParsers } from "../src/node/parsers.js";
import { runPipeline } from "../src/pipeline.js";

const id = process.argv[2] ?? "pr1";
const semantic = process.argv.includes("--embeddings");
const overrideArg = process.argv.indexOf("--config");
const overrides = overrideArg > 0 ? JSON.parse(process.argv[overrideArg + 1]) : {};
const config = mergeConfig({ ...overrides, semantic: { ...overrides.semantic, enabled: semantic } });
const result = await runPipeline(loadPr(id), config, {
  parsers: await createNodeParsers(),
  embedder: semantic ? new TransformersEmbedder(config.semantic.model) : null,
});

const truth = loadTruth(id);
const truthOf = new Map(truth.flatMap((g) => g.hunks.map((h) => [h, g.id] as const)));
console.log(`\n== ${id}: hunks`);
for (const h of result.hunks.values()) {
  console.log(
    `${h.hunk.id.padEnd(34)} [${truthOf.get(h.hunk.id)}] sym=${h.symbol} ${h.mechanical ? `MECH(${h.mechanical.kind})` : ""}${h.commentOnly ? " COMMENT" : ""}`,
  );
  console.log(`   def={${[...h.defines].join(",")}} imp={${[...h.impacts].join(",")}} ref={${[...h.references].join(",")}}`);
}
console.log(`\n== pairs (weight >= ${config.minEdgeWeight})`);
for (const p of [...result.pairs].sort((a, b) => b.weight - a.weight)) {
  if (p.weight < config.minEdgeWeight) continue;
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
  console.log(`[${g.id}] ${g.title}\n   ${g.rationale}`);
  for (const h of g.hunkIds) console.log(`     ${h}  (truth: ${truthOf.get(h)})`);
}
console.log(`\nARI = ${adjustedRandIndex(labelsFromTruth(truth), labelsFromGroups(result.groups)).toFixed(3)}`);
