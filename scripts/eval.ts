/**
 * Runs every fixture PR in three configurations and scores the clusters against
 * truth.json with the Adjusted Rand Index.
 *
 *   npm run eval                       # all three configs (LLM via `claude -p`)
 *   npm run eval -- --llm codex        # use `codex exec` for the LLM config
 *   npm run eval -- --no-llm           # skip the LLM config
 *   npm run eval -- --config '{"louvain":{"resolution":0.8}}'   # override PipelineConfig
 *
 * Titles do not affect clustering, so config C has the same ARI as B; for it we
 * also report title overlap with the ground-truth titles (token F1), for both titlers.
 */
import { mergeConfig } from "../src/core/config.js";
import type { ReviewResult } from "../src/core/types.js";
import { adjustedRandIndex, labelsFromGroups, labelsFromTruth } from "../src/eval/ari.js";
import { TransformersEmbedder } from "../src/node/embedder.js";
import { listPrIds, loadPr, loadTruth, type TruthGroup } from "../src/node/fixtures.js";
import { CliLlmTitler, type LlmCli } from "../src/node/llmTitler.js";
import { createNodeParsers } from "../src/node/parsers.js";
import { runPipeline } from "../src/pipeline.js";

const args = process.argv.slice(2);
const llmCli = (args[args.indexOf("--llm") + 1] ?? "claude") as LlmCli;
const withLlm = !args.includes("--no-llm");
const only = args.find((a) => /^pr\d+$/.test(a));

const parsers = await createNodeParsers();
const overrideArg = args.indexOf("--config");
const overrides = overrideArg >= 0 ? JSON.parse(args[overrideArg + 1]) : {};
const structuralOnly = mergeConfig({ ...overrides, semantic: { ...overrides.semantic, enabled: false } });
const withEmbeddings = mergeConfig({ ...overrides, semantic: { ...overrides.semantic, enabled: true } });
const embedder = new TransformersEmbedder(withEmbeddings.semantic.model);

interface Row {
  pr: string;
  hunks: number;
  truthGroups: number;
  ari: [number, number, number | null];
  groups: [number, number];
  titleF1: { heuristic: number; llm: number | null };
  llmMs: number | null;
  warnings: string[];
}

const rows: Row[] = [];
for (const id of only ? [only] : listPrIds()) {
  const pr = loadPr(id);
  const truth = loadTruth(id);
  const truthLabels = labelsFromTruth(truth);
  const ari = (r: ReviewResult) => adjustedRandIndex(truthLabels, labelsFromGroups(r.groups));

  const a = await runPipeline(pr, structuralOnly, { parsers });
  const b = await runPipeline(pr, withEmbeddings, { parsers, embedder });
  const c = withLlm ? await runPipeline(pr, withEmbeddings, { parsers, embedder, titler: new CliLlmTitler(llmCli) }) : null;

  rows.push({
    pr: id,
    hunks: a.hunks.size,
    truthGroups: truth.length,
    ari: [ari(a), ari(b), c ? ari(c) : null],
    groups: [a.groups.length, b.groups.length],
    titleF1: { heuristic: titleScore(b, truth), llm: c ? titleScore(c, truth) : null },
    llmMs: c ? c.timings.title : null,
    warnings: [...(c?.warnings ?? [])],
  });
  process.stderr.write(`  ${id} done\n`);
}

const fmt = (x: number | null) => (x === null ? "  -  " : x.toFixed(3));
const header = ["PR", "hunks", "truth", "A: struct", "B: +emb", "C: +emb+LLM", "groups A/B", "title F1 heur", "title F1 LLM", "LLM ms"];
const table = rows.map((r) => [
  r.pr,
  String(r.hunks),
  String(r.truthGroups),
  fmt(r.ari[0]),
  fmt(r.ari[1]),
  fmt(r.ari[2]),
  `${r.groups[0]}/${r.groups[1]}`,
  fmt(r.titleF1.heuristic),
  fmt(r.titleF1.llm),
  r.llmMs === null ? "-" : String(r.llmMs),
]);
const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};
table.push([
  "mean",
  "",
  "",
  fmt(mean(rows.map((r) => r.ari[0]))),
  fmt(mean(rows.map((r) => r.ari[1]))),
  fmt(mean(rows.map((r) => r.ari[2]))),
  "",
  fmt(mean(rows.map((r) => r.titleF1.heuristic))),
  fmt(mean(rows.map((r) => r.titleF1.llm))),
  "",
]);
const widths = header.map((h, i) => Math.max(h.length, ...table.map((r) => r[i].length)));
const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join(" | ");
console.log(`\n${line(header)}\n${widths.map((w) => "-".repeat(w)).join("-|-")}`);
for (const r of table) console.log(line(r));
for (const r of rows) for (const w of r.warnings) console.log(`warning ${r.pr}: ${w}`);

/** Token-F1 between each predicted semantic group's title and the title of its majority truth group, averaged. */
function titleScore(result: ReviewResult, truth: TruthGroup[]): number {
  const truthOf = new Map(truth.flatMap((g) => g.hunks.map((h) => [h, g] as const)));
  const groups = result.groups.filter((g) => g.kind === "semantic");
  if (groups.length === 0) return 1;
  const scores = groups.map((g) => {
    const counts = new Map<TruthGroup, number>();
    for (const h of g.hunkIds) counts.set(truthOf.get(h)!, (counts.get(truthOf.get(h)!) ?? 0) + 1);
    const best = [...counts].sort((x, y) => y[1] - x[1])[0][0];
    return tokenF1(g.title, best.title);
  });
  return scores.reduce((s, x) => s + x, 0) / scores.length;
}

function tokenF1(a: string, b: string): number {
  const STOP = new Set(["the", "a", "an", "to", "of", "and", "in", "for", "with", "add", "update", "more"]);
  const toks = (s: string) =>
    s
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !STOP.has(t));
  const x = toks(a);
  const y = new Set(toks(b));
  if (x.length === 0 || y.size === 0) return 0;
  const hit = new Set(x.filter((t) => y.has(t))).size;
  if (hit === 0) return 0;
  const p = hit / new Set(x).size;
  const r = hit / y.size;
  return (2 * p * r) / (p + r);
}
