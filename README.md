<img src="assets/icon.svg" width="64" height="64" alt="">

# Semantic-pr

Prototype of a "semantic diff review" tool. Instead of listing changed files
alphabetically, it groups diff hunks by how related they are and renders them
as a static HTML page.

Created in [T3 Code](https://t3.codes).

Everything runs locally: tree-sitter via WASM, embeddings via transformers.js
(ONNX on CPU), optional titles via a local agent CLI. The only network access
is the one-time download of the embedding model.

## Run

```sh
npm install

npm run review                          # all fixture PRs -> out/<pr>.html + out/index.html
npm run review -- pr2 pr5 --embeddings  # selected PRs, + local MiniLM embeddings
npm run review -- --embeddings --llm claude   # LLM titles via `claude -p`
npm run review -- --llm codex --llm-model gpt-5-mini   # or `codex exec`

npm run eval                            # 3 configs x all PRs, ARI table (uses `claude -p`)
npm run eval -- --llm codex             # LLM config via codex
npm run eval -- --no-llm                # skip the LLM config
npm run eval -- --config '{"louvain":{"resolution":0.8}}'   # try other weights/params

npm run debug -- pr6 --embeddings       # per-hunk facts, pair scores, merges, groups vs truth
npm run fixtures                        # regenerate fixture patches and validate truth.json
npm run typecheck
```

The HTML files are self-contained (diff2html CSS inlined, no external requests).
Each page has three tabs:
- **Grouped**: collapsible groups with title, rationale, and hunk count. Hunks
  are ordered within each group and link to their strongest neighbors.
- **By file (A–Z)**: the plain view, for comparison. Badges show which group
  each hunk landed in.
- **Debug**: every scored hunk pair with per-signal scores, evidence (hover a
  score), the weighted total, and edge/cross-group status. Also shows
  post-clustering merges and per-hunk facts (symbol, defines, impacts,
  references).

## Results (current fixtures)

```
PR   | hunks | truth | A: struct | B: +emb | C: +emb+LLM | groups A/B | title F1 heur | title F1 LLM
pr1  | 20    | 2     | 1.000     | 1.000   | 1.000       | 2/2        | 0.682         | 0.729
pr2  | 19    | 3     | 0.903     | 1.000   | 1.000       | 4/3        | 0.564         | 0.900
pr3  | 8     | 3     | 1.000     | 1.000   | 1.000       | 3/3        | 1.000         | 0.714
pr4  | 2     | 1     | 1.000     | 1.000   | 1.000       | 1/1        | 0.250         | 0.545
pr5  | 21    | 5     | 0.951     | 0.951   | 0.951       | 5/5        | 0.367         | 0.785
pr6  | 14    | 4     | 0.875     | 0.875   | 0.875       | 4/4        | 0.429         | 0.872
pr7  | 1     | 1     | 1.000     | 1.000   | 1.000       | 1/1        | 0.000         | 0.889
pr8  | 2     | 1     | 1.000     | 1.000   | 1.000       | 1/1        | 0.333         | 0.857
pr9  | 3     | 1     | 1.000     | 1.000   | 1.000       | 1/1        | 1.000         | 1.000
mean |       |       | 0.970     | 0.981   | 0.981       |            | 0.514         | 0.810
```

- **ARI** compares hunk clusters to `truth.json`. Misc hunks count as
  singletons, and the mechanical group counts as one cluster.
- **Titles don't change clustering**, so C has the same ARI as B. That is why
  the table also reports *title F1*: token overlap between each group's title
  and the title of its majority ground-truth group. It's crude, but it shows
  what the LLM adds.
- **Remaining misses are by design.** In pr5, three comment-only JSDoc hunks
  have nothing linking them, not even in embeddings, so they land in misc. In
  pr6, a hunk that mixes two concerns pulls the baseUrl change into the
  request-id group. See each `truth.json`'s `notes`.
- **Caveat:** the weights and thresholds were tuned on these same 9 PRs, so
  treat the numbers as a smoke test, not a benchmark.

## Pipeline

```
diff text ──parse──▶ files/hunks ──analyze (tree-sitter)──▶ HunkInfo
   ──mechanical?──▶ collapsed group
   ──score pairs (5 signals)──▶ weighted graph ──Louvain + refine──▶ communities
   ──order (topological)──▶ groups ──titler──▶ ReviewResult ──render──▶ HTML
```

| Module | What it does |
|---|---|
| `src/diff/parse.ts` | Unified diff → files and hunks with stable `path#n` IDs; rebuilds per-hunk/per-file patches for rendering. |
| `src/parse/treesitter.ts`, `symbols.ts` | web-tree-sitter (TS/TSX WASM grammars). Per file: declarations with spans, per-line identifiers (definition vs. use, plain `name` vs. member `.name`), string literals, comments, imports. |
| `src/analyze/hunks.ts` | Expands each hunk to its innermost enclosing declaration (`symbol`, e.g. `HttpClient.request`). Records what it **defines** (decls added/removed/changed, members declared on changed lines), what it **references**, and one hop of **impact** (unchanged module-level functions in the same file that use something it changed). |
| `src/analyze/mechanical.ts` | Lockfiles, generated files (path or `@generated`/`DO NOT EDIT` header), pure renames, binary, whitespace-only hunks, and dependency-only `package.json` edits that come with a lockfile change. |
| `src/score/signals.ts`, `index.ts` | Pairwise signals, each 0..1 with evidence strings (see below). |
| `src/cluster/louvain.ts`, `refine.ts` | graphology + Louvain (seeded, resolution 0.5) on edges ≥ `minEdgeWeight`. Refine step: if a hunk *introduces* a symbol used by a hunk in another community, merge the two. A new helper belongs with its caller. Singletons go to **misc**. |
| `src/order/topo.ts` | Kahn's algorithm: definitions before usages, code before tests. Groups are ordered the same way; misc and mechanical come last. |
| `src/title/` | `Titler` interface. `HeuristicTitler` (default) recognizes renames (`X → Y` substitution in most hunks), moves (decl removed in one file, added in another), and doc-only groups. Otherwise it names the group's hub symbol, i.e. the non-test hunk with the most link weight. `src/node/llmTitler.ts` sends one prompt per PR to `claude -p` / `codex exec` and parses a JSON array. It falls back to heuristics per group on any failure. |
| `src/render/html.ts` | Self-contained page; diff2html renders the diffs (server-side, so the page needs no diff JS). |
| `src/pipeline.ts` | Orchestration. |
| `src/eval/ari.ts`, `scripts/eval.ts` | Adjusted Rand Index and the comparison table. |
| `src/node/*` | Node-only adapters: fixture loading (`FileProvider`), WASM paths, embedder with disk cache, LLM CLI, the `review` CLI. |

### Signals (weights in `src/core/config.ts`)

| Signal | Weight | Score |
|---|---|---|
| structural | 1.0 | A defines/changes a symbol B references (or both change it). IDF-damped per symbol; impact links ×0.6. Member refs (`x.retries`) only match members, plain refs (`now`) only match top-level decls. |
| testPairing | 0.9 | Test hunk ↔ code hunk whose file the test imports: 1.0 if the test uses a symbol the hunk changed, 0.6 if it uses an impacted symbol, 0.15 if import-only. |
| lexical | 0.45 | IDF-weighted overlap of identifiers/string literals on changed lines (geometric-mean normalized). |
| semantic | 0.5 | Cosine similarity of `Xenova/all-MiniLM-L6-v2` embeddings (path + symbol + changed lines), rescaled above 0.5. Only with `--embeddings`. |
| path | 0.1 | Same file 1, same logical dir 0.6 (tests/x ≡ src/x), same top dir 0.3. Never enough to link on its own. |

Edges below `minEdgeWeight` (0.22) are dropped, so one weak coincidence (a
shared token, the same directory) never links two hunks by itself.

### Porting to an Azure DevOps extension

Everything under `src/` except `src/node/` is browser-safe (no `fs`,
`child_process`, or `node:path`). In the extension you would:
- Implement `FileProvider` with the Git REST API (item content at the source
  and target commits).
- Pass grammar `.wasm` URLs to `SyntaxParsers.create`.
- Run transformers.js in the browser for the embedder.
- Replace the CLI titler with whatever LLM endpoint is allowed, or keep the
  heuristic one.

## Fixtures

```
fixtures/
  sample-repo/            base tree of a small TS SDK (http client, config, users, utils, tests)
  prs/<id>/
    pr.json               title, description, file renames/deletes
    files/                full post-change contents of every added/modified file (overlay)
    diff.patch            generated: git diff -M base..PR
    hunks.json            generated: every hunk ID with a short preview
    truth.json            hand-written ground truth: groups, why, and notes on the traps
```

**Hunk IDs** are `<path>#<n>`. `path` is the post-change path (the pre-change
path for deletions) and `n` is the 0-based hunk index within that file. A file
change with no hunks, like a pure rename, gets a single pseudo-hunk `#0`.
File contents for the pipeline: the pre-image comes from `sample-repo/`; the
post-image comes from `prs/<id>/files/`, falling back to the base for pure
renames.

| PR | Kind | Concerns | Hunks |
|----|------|----------|------:|
| pr1 | hard | `UserRecord` → `User` rename (5 files) + HTTP retry with backoff (config option, helpers, tests) | 20 |
| pr2 | hard | `searchUsers` feature + logging cleanup (one file split 3 ways) + vitest bump/lockfile + regenerated file | 19 |
| pr3 | medium | move `buildQueryString` to `utils/query.ts` + call sites/tests, a pure rename, a stray default change | 8 |
| pr4 | simple | bug fix + regression test | 2 |
| pr5 | hardest | 5 interleaved concerns: update endpoint, cache stats, JSDoc pass, email regex fix, deps/generated/whitespace. One hunk mixes docs + feature. | 21 |
| pr6 | hardest | request-id tracing + cache kill-switch + baseUrl validation + dead code, sharing files and vocabulary. One test hunk mixes two concerns. | 14 |
| pr7 | trivial | one-line message change | 1 |
| pr8 | simple | new util + its test | 2 |
| pr9 | simple | dependabot-style bump (all mechanical) | 3 |

To change a fixture, edit `files/` and rerun `npm run fixtures`, then fix any
`truth.json` errors it reports.

## Known limitations

- **TS/JS only.** Other languages fall back to a regex tokenizer (lexical
  signal only).
- **Hunks are the atom.** A hunk that mixes two concerns can't be split
  (pr5, pr6).
- **Structural matching is name-based**, not type-resolved. Two unrelated
  members with the same name can link; the stopword list and the plain/member
  split reduce this.
- **No line-level move detection** beyond declaration names.
