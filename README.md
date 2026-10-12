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

npm run review -- t3code-17901 --embeddings --llm claude   # a real PR from fixtures/real
npm run review -- --repo <path> --commit <sha>             # any local git repo: <sha>^..<sha>
npm run review -- --repo <path> --base main --head feature --name my-pr

npm run eval                            # 3 configs x all PRs, ARI table (uses `claude -p`)
npm run eval -- --real-only | --synthetic-only
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

## Results

Two sets of test cases:
- **Synthetic** (`fixtures/prs`): 9 hand-built PRs on a toy repo, with
  hunk-level truth. Several deliberately split a file across concerns.
- **Real** (`fixtures/real`): 3 merged PRs from
  [T3 Code](https://github.com/pingdotgg/t3code). The code is read from a
  blobless clone in `.cache/repos`, created on first use, and nothing in it is
  executed. The truth is a file-level, reviewer-style split I wrote from each
  PR's description and diff.
- **#17826 is held out:** its truth was written before the pipeline ever ran
  on it, and it was not used for tuning.

```
PR             | hunks | truth | A: struct | B: +emb | C: +emb+LLM | title F1 heur | title F1 LLM
pr1            | 20    | 2     | 1.000     | 1.000   | 1.000       | 0.682         | 0.729
pr2            | 19    | 3     | 0.812     | 1.000   | 1.000       | 0.564         | 0.900
pr3            | 8     | 3     | 1.000     | 1.000   | 1.000       | 1.000         | 0.714
pr4            | 2     | 1     | 1.000     | 1.000   | 1.000       | 0.250         | 0.545
pr5            | 21    | 5     | 0.783     | 0.783   | 0.783       | 0.425         | 0.833
pr6            | 14    | 4     | 0.782     | 0.752   | 0.752       | 0.343         | 0.567
pr7            | 1     | 1     | 1.000     | 1.000   | 1.000       | 0.000         | 0.889
pr8            | 2     | 1     | 1.000     | 1.000   | 1.000       | 0.333         | 0.857
pr9            | 3     | 1     | 1.000     | 1.000   | 1.000       | 1.000         | 1.000
t3code-17563   | 68    | 5     | 0.696     | 0.581   | 0.581       | 0.131         | 0.307
t3code-17826 * | 43    | 4     | 0.759     | 1.000   | 1.000       | 0.114         | 0.768
t3code-17901   | 104   | 6     | 0.463     | 0.573   | 0.573       | 0.229         | 0.348
mean synthetic |       |       | 0.931     | 0.948   | 0.948       | 0.511         | 0.782
mean real      |       |       | 0.640     | 0.718   | 0.718       | 0.158         | 0.475
                                                                        * held out
```

- **ARI** compares hunk clusters to the truth. Misc hunks count as
  singletons, and the mechanical group counts as one cluster.
- **Titles don't change clustering**, so C has the same ARI as B. That's why
  the table also reports *title F1*: token overlap with the truth title of
  each group's majority truth group. It's crude, but it shows what the LLM
  adds.
- **Lessons from the real PRs:**
  - The "a new helper merges into its caller" rule, which helped the synthetic
    set, chained a 104-hunk refactor into one group (ARI 0.05). It now only
    absorbs small communities whose new symbols have a single user group, and
    merges never chain.
  - Louvain resolution 1.0 works for both sets once that rule is fixed.
  - Monorepo imports (`@scope/pkg/sub`) are resolved against the changed files.
  - Same-file cohesion (path weight 0.1 → 0.25) helps real PRs (+0.13) and
    costs synthetic (−0.04), because those deliberately split files. The
    real-PR truth is file-level, which partly rewards this by construction.
- **Remaining synthetic misses are by design.** These are pr5's unrelated doc
  comments and pr6's mixed hunk; see each `truth.json`'s `notes`.
- **Caveat:** the weights were tuned on everything except #17826. Treat the
  numbers as a smoke test, not a benchmark.

Example LLM-titled groups for t3code#17901 (104 hunks → 5 groups):
"Move host settings schemas onto client definitions" (35),
"Render each host's settings form from its schema" (22),
"Store host secrets generically and migrate legacy keys" (18),
"Add GitCafe token setting ahead of CAFE_TOKEN" (26),
"Replace patched host fields per source control host" (3).

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
| `src/cluster/louvain.ts`, `refine.ts` | graphology + Louvain (seeded, resolution 1.0) on edges ≥ `minEdgeWeight`. Refine step: a small community (≤ 4 hunks) whose newly added symbols are used by exactly one other community is absorbed into it, with no chaining. A new private helper belongs with its caller. Singletons go to **misc**. |
| `src/order/topo.ts` | Kahn's algorithm: definitions before usages, code before tests. Groups are ordered the same way; misc and mechanical come last. |
| `src/title/` | `Titler` interface. `HeuristicTitler` (default) recognizes renames (`X → Y` substitution in most hunks), moves (decl removed in one file, added in another), and doc-only groups. Otherwise it names the group's hub symbol, i.e. the non-test hunk with the most link weight. `src/node/llmTitler.ts` sends one prompt per PR to `claude -p` / `codex exec` and parses a JSON array. It falls back to heuristics per group on any failure. |
| `src/render/html.ts` | Self-contained page; diff2html renders the diffs (server-side, so the page needs no diff JS). |
| `src/pipeline.ts` | Orchestration. |
| `src/eval/ari.ts`, `scripts/eval.ts` | Adjusted Rand Index and the comparison table. |
| `src/node/*` | Node-only adapters: fixture and git loading (`FileProvider` via `git show`), WASM paths, embedder with disk cache, LLM CLI, the `review` CLI. |

### Signals (weights in `src/core/config.ts`)

| Signal | Weight | Score |
|---|---|---|
| structural | 1.0 | A defines/changes a symbol B references (or both change it). IDF-damped per symbol; impact links ×0.6. Member refs (`x.retries`) only match members, plain refs (`now`) only match top-level decls. |
| testPairing | 0.9 | Test hunk ↔ code hunk whose file the test imports: 1.0 if the test uses a symbol the hunk changed, 0.6 if it uses an impacted symbol, 0.15 if import-only. |
| lexical | 0.45 | IDF-weighted overlap of identifiers/string literals on changed lines (geometric-mean normalized). |
| semantic | 0.5 | Cosine similarity of `Xenova/all-MiniLM-L6-v2` embeddings (path + symbol + changed lines), rescaled above 0.5. Only with `--embeddings`. |
| path | 0.25 | Same file 1, same logical dir 0.6 (tests/x ≡ src/x), same top dir 0.3. Never enough to link on its own. |

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
fixtures/real/<id>/
  pr.json               repo URL + squash-merge commit of a real PR
  truth.json            file-level truth (`files`: exact paths or "dir/" prefixes)
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
