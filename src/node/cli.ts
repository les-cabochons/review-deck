/**
 * Renders fixture PRs to self-contained HTML.
 *
 *   npm run review                           # all PRs, structural signals, heuristic titles
 *   npm run review -- pr2 pr5 --embeddings   # selected PRs, + local embeddings
 *   npm run review -- --llm claude           # LLM titles via `claude -p` (or `codex`)
 *   npm run review -- --out some/dir --llm-model haiku
 *
 * Any local git repository (nothing in it is executed):
 *   npm run review -- --repo ../t3code --commit 4f63275      # a squash-merged PR: commit^..commit
 *   npm run review -- --repo ../t3code --base main --head feature --name my-pr
 *   npm run review -- t3code-17901 --embeddings              # a real PR from fixtures/real (cloned on first use)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { mergeConfig } from "../core/config.js";
import { runPipeline } from "../pipeline.js";
import { renderReport } from "../render/html.js";
import { TransformersEmbedder } from "./embedder.js";
import { ensureRealRepo, listPrIds, listRealPrIds, loadPr, ROOT } from "./fixtures.js";
import { loadGitPr } from "./git.js";
import { CliLlmTitler, type LlmCli } from "./llmTitler.js";
import { createNodeParsers } from "./parsers.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const llm = option("--llm") as LlmCli | undefined;
if (llm && llm !== "claude" && llm !== "codex") throw new Error(`--llm must be "claude" or "codex", got ${llm}`);
const outDir = resolve(option("--out") ?? join(ROOT, "out"));
const VALUE_OPTIONS = ["--llm", "--out", "--llm-model", "--repo", "--commit", "--base", "--head", "--name"];
const optionValues = new Set(VALUE_OPTIONS.map(option).filter(Boolean));
const requested = args.filter((a) => !a.startsWith("--") && !optionValues.has(a));

const repo = option("--repo");
const commit = option("--commit");
const gitName = option("--name") ?? (commit ? `commit-${commit.slice(0, 8)}` : "git-diff");
const ids = repo
  ? [gitName]
  : requested.length === 0 || requested.includes("all")
    ? [...listPrIds(), ...listRealPrIds()]
    : requested;
const load = (id: string) => {
  if (!repo && listRealPrIds().includes(id)) {
    const { spec, dir } = ensureRealRepo(id);
    return loadGitPr(dir, `${spec.commit}^`, spec.commit, spec);
  }
  if (!repo) return loadPr(id);
  const base = commit ? `${commit}^` : option("--base");
  const head = commit ?? option("--head");
  if (!base || !head) throw new Error("--repo needs --commit <sha> or --base <rev> --head <rev>");
  return loadGitPr(resolve(repo), base, head);
};

const config = mergeConfig({ semantic: { enabled: flag("--embeddings") } });
const parsers = await createNodeParsers();
const embedder = config.semantic.enabled ? new TransformersEmbedder(config.semantic.model) : null;
const titler = llm ? new CliLlmTitler(llm, { model: option("--llm-model") }) : undefined;
const css = readFileSync(createRequire(import.meta.url).resolve("diff2html/bundles/css/diff2html.min.css"), "utf8");

mkdirSync(outDir, { recursive: true });
const index: string[] = [];
for (const id of ids) {
  const result = await runPipeline(await load(id), config, { parsers, embedder, titler });
  const file = join(outDir, `${id}.html`);
  writeFileSync(file, renderReport(result, { diff2htmlCss: css }));
  const groups = result.groups.filter((g) => g.kind === "semantic");
  console.log(`${id}: ${result.hunks.size} hunks -> ${groups.length} groups -> ${file}`);
  for (const g of result.groups) console.log(`   [${g.kind === "semantic" ? g.id : g.kind}] ${g.title} (${g.hunkIds.length})`);
  for (const w of result.warnings) console.log(`   warning: ${w}`);
  index.push(
    `<li><a href="${id}.html">${id}</a>: ${escapeHtml(result.title)} <small>(${result.hunks.size} hunks, ${groups.length} groups)</small><ul>${groups
      .map((g) => `<li>${escapeHtml(g.title)}</li>`)
      .join("")}</ul></li>`,
  );
}
writeFileSync(
  join(outDir, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>Semantic PR review</title>
<style>body{font-family:system-ui,sans-serif;max-width:900px;margin:40px auto;line-height:1.5}small{color:#666}li ul{color:#444;font-size:14px}</style>
<h1>Semantic PR review</h1><p>signals: structural, test pairing, lexical, path${config.semantic.enabled ? ", semantic" : ""} · titles: ${titler?.name ?? "heuristic"}</p><ul>${index.join("\n")}</ul>`,
);

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
