/**
 * Runs every fixture PR in three configurations and scores the clusters against
 * truth.json with the Adjusted Rand Index.
 *
 *   npm run eval                       # all three configs (LLM via `claude -p`)
 *   npm run eval -- --llm codex        # use `codex exec` for the LLM config
 *   npm run eval -- --no-llm           # skip the LLM config
 *   npm run eval -- --config '{"louvain":{"resolution":0.8}}'   # override PipelineConfig
 *   npm run eval -- --real-only | --synthetic-only | pr5 t3code-17901
 *
 * Real PRs (fixtures/real/<id>) are read from a blobless clone in .cache/repos,
 * created on first use; nothing in the cloned repository is executed.
 *
 * Titles do not affect clustering, so config C has the same ARI as B; for it we
 * also report title overlap with the ground-truth titles (token F1), for both titlers.
 */
import { mergeConfig } from "../src/core/config.js";
import type { ReviewResult } from "../src/core/types.js";
import { parseDiff } from "../src/diff/parse.js";
import { adjustedRandIndex, labelsFromGroups, labelsFromTruth } from "../src/eval/ari.js";
import { TransformersEmbedder } from "../src/node/embedder.js";
import {
  ensureRealRepo,
  listPrIds,
  listRealPrIds,
  loadPr,
  loadRealTruth,
  loadTruth,
  type TruthGroup,
} from "../src/node/fixtures.js";
import { loadGitPr } from "../src/node/git.js";
import { CliLlmTitler, type LlmCli } from "../src/node/llmTitler.js";
import { createNodeParsers } from "../src/node/parsers.js";
import { type PrInput, runPipeline } from "../src/pipeline.js";

const args = process.argv.slice(2);
const llmArg = args.indexOf("--llm");
const llmCli = (llmArg >= 0 ? args[llmArg + 1] : "claude") as LlmCli;
const withLlm = !args.includes("--no-llm");
const only = args.filter((a) => /^(pr\d+|[\w-]+-\d+)$/.test(a));
const sets = args.includes("--real-only") ? ["real"] : args.includes("--synthetic-only") ? ["synthetic"] : ["synthetic", "real"];

const parsers = await createNodeParsers();
const overrideArg = args.indexOf("--config");
const overrides = overrideArg >= 0 ? JSON.parse(args[overrideArg + 1]) : {};
const structuralOnly = mergeConfig({ ...overrides, semantic: { ...overrides.semantic, enabled: false } });
const withEmbeddings = mergeConfig({ ...overrides, semantic: { ...overrides.semantic, enabled: true } });
const embedder = new TransformersEmbedder(withEmbeddings.semantic.model);

interface Case {
  id: string;
  set: "synthetic" | "real";
  load: () => Promise<{ pr: PrInput; truth: TruthGroup[] }>;
}

const cases: Case[] = [
  ...(sets.includes("synthetic") ? listPrIds() : []).map((id): Case => ({
    id,
    set: "synthetic",
    load: async () => ({ pr: loadPr(id), truth: loadTruth(id) }),
  })),
  ...(sets.includes("real") ? listRealPrIds() : []).map((id): Case => ({
    id,
    set: "real",
    load: async () => {
      const { spec, dir } = ensureRealRepo(id);
      const pr = await loadGitPr(dir, `${spec.commit}^`, spec.commit, { title: spec.title, description: spec.description });
      const hunkIds = parseDiff(pr.diff).flatMap((f) => f.hunks.map((h) => h.id));
      return { pr, truth: loadRealTruth(id, hunkIds) };
    },
  })),
].filter((c) => only.length === 0 || only.includes(c.id));

interface Row {
  pr: string;
  set: string;
  hunks: number;
  truthGroups: number;
  ari: [number, number, number | null];
  groups: [number, number];
  titleF1: { heuristic: number; llm: number | null };
  llmMs: number | null;
  warnings: string[];
}

const rows: Row[] = [];
for (const c of cases) {
  const { pr, truth } = await c.load();
  const truthLabels = labelsFromTruth(truth);
  const ari = (r: ReviewResult) => adjustedRandIndex(truthLabels, labelsFromGroups(r.groups));

  const a = await runPipeline(pr, structuralOnly, { parsers });
  const b = await runPipeline(pr, withEmbeddings, { parsers, embedder });
  const llm = withLlm ? await runPipeline(pr, withEmbeddings, { parsers, embedder, titler: new CliLlmTitler(llmCli) }) : null;

  rows.push({
    pr: c.id,
    set: c.set,
    hunks: a.hunks.size,
    truthGroups: truth.length,
    ari: [ari(a), ari(b), llm ? ari(llm) : null],
    groups: [a.groups.length, b.groups.length],
    titleF1: { heuristic: titleScore(b, truth), llm: llm ? titleScore(llm, truth) : null },
    llmMs: llm ? llm.timings.title : null,
    warnings: [...(llm?.warnings ?? [])],
  });
  process.stderr.write(`  ${c.id} done
`);
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
for (const set of ["synthetic", "real"]) {
  const subset = rows.filter((r) => r.set === set);
  if (subset.length === 0) continue;
  table.push([
    `mean ${set}`,
    "",
    "",
    fmt(mean(subset.map((r) => r.ari[0]))),
    fmt(mean(subset.map((r) => r.ari[1]))),
    fmt(mean(subset.map((r) => r.ari[2]))),
    "",
    fmt(mean(subset.map((r) => r.titleF1.heuristic))),
    fmt(mean(subset.map((r) => r.titleF1.llm))),
    "",
  ]);
}
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
