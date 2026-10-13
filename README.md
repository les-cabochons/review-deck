

# <img src="assets/icon.svg" height="30" alt=""> Review Deck

Review Deck is a "semantic diff review" tool. Instead of listing changed files
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

## Azure DevOps Services extension

`extension/` replaces the Azure DevOps pull request pages with two full-width
pages:
- **A PR hub:** a Graphite-style inbox of the pull requests that involve you.
- **A review page:** Overview / Files / Commits. Files is **semantically
  grouped by default**, with an A–Z toggle and inline / side-by-side diffs.

The visual language is Graphite's layout and density in an Azure DevOps skin:
- Azure DevOps theme variables, fonts and icons.
- `azure-devops-ui` buttons, split buttons and menus.

It reuses the pipeline above in the browser (tree-sitter WASM, structural
signals, heuristic titles). When it's built with `SEMANTIC_PR_BACKEND_URL`, a
small Azure Function (`backend/`, deployed by `infra/`, capped to stay under
$1/month) adds hunk embeddings for grouping and, in projects that opt in,
group titles from gpt-5-nano.
See [docs/azure-backend.md](docs/azure-backend.md).

```sh
npm run ext:mock        # mock PR list + full snapshots from real t3code PRs (uses gh + the blobless clone)
npm run ext:demo        # replace the mock with a fictional demo (Marketplace screenshots); ext:mock restores it
npm run ext:dev         # http://127.0.0.1:5173/dev/ : fake Azure DevOps frame, live reload, light/dark
npm run ext:build       # production bundle -> extension/dist + extension/assets
npm run ext:package     # private .vsix using publisher Cabochonio
npm run ext:typecheck
npm run ext:test        # adapter and local write regression tests
npm run ext:test:browser # build the isolated browser failure-test page
```

The `justfile` wraps development, checks, builds, packaging, review, and evaluation.
Run `just check` for both typechecks and the write regression tests.

**Local development without installing:**
- **The dev shell** (`/dev/`) wraps the page in a fake Azure DevOps frame:
  top bar, left nav with Repos › Deck, and the page in an iframe, like
  the real hub.
- **Mock data:** the page runs against `extension/dev-data`. This includes a
  63-PR list built from real T3 Code PRs (some reviewer votes are synthetic so
  every inbox section has rows) and three openable PRs with in-memory writes.
- **Live reload and themes:** the page reloads on every rebuild, and the theme
  dropdown switches the Azure DevOps light/dark variables.
- **Shareable URLs:** the shell URL mirrors the route (`?pr=17901&repo=t3code`),
  so reloads and links keep the page.

**What's there:**
- **PR hub:**
  - Inbox sections: Needs your review, Returned to you, Approved, Waiting for
    review, Drafts, You reviewed, Recently completed, Other active.
  - A sidebar filter and a search box (`/` to focus).
  - A repository filter.
  - Dense rows: state, author, review state, reviewer votes, checks, active
    comments, size, age.
  - j/k to move, Enter to open.
  - Opening a PR stays inside the hub and updates the host URL
    (`?pr=<id>&repo=<id>`).
- **Header:**
  - A breadcrumb back to the hub, plus title, status, author, and source →
    target branch.
  - Stats: files, +/−, number of concerns.
  - "Review" / "Finish review (n)".
  - The Azure DevOps vote split button: **Approve | ▾** with the other votes
    and "Reset feedback".
  - Complete ▾ (disabled, milestone 3) and ⋯.
- **Reviews like GitHub:**
  - Line comments and replies can "Start a review" instead of posting
    immediately. Drafts show inline as Pending, can be edited or deleted, and
    survive reloads (stored per PR and user).
  - "Finish review" opens a panel for a summary plus a verdict (Comment,
    Approve, Approve with suggestions, Wait for author, Reject) and posts
    everything at once. Azure DevOps has no server-side pending review, so
    drafts stay private until you submit.
- **Comment editor:**
  - Write / Preview.
  - An Azure DevOps-style toolbar: heading, bold, italic, strikethrough,
    quote, code, link, lists, checklist, @mention.
  - Shortcuts: Ctrl+B/I/E/K, and Ctrl+Enter to submit.
  - `@` suggestions from the PR's people plus the identity directory, inserted
    as Azure DevOps `@<id>` mentions and rendered as names.
  - Each comment's ⋯ menu has Quote reply (quotes the selected text, or the
    whole comment), Copy link and Copy text.
- **Overview:**
  - An editable description with Markdown preview and a general comment composer.
  - The description (markdown) and a GitHub-style timeline: updates with
    their commits, votes, and comment threads (general and file-anchored)
    with replies and status.
  - A sidebar with a semantic summary ("Changes by concern"; click to jump
    to a group), reviewers and votes, required/optional checks (policy
    evaluations), tags and work items.
  - Search and add reviewers, change required/optional status, remove reviewers,
    and add or remove tags. Vote as the signed-in user using any Azure DevOps vote option.
- **Files:**
  - Toolbar in Azure DevOps' style. "Group by concern" and "Side by side" are
    toggle buttons: one click flips them, and they look pressed when on.
    "Base ▾ → Update n ▾" are dropdowns, since they pick one of several updates.
  - Grouped (concern, rationale, hunks ordered definitions-first) or A–Z.
  - Pierre Diffs (`@pierre/diffs`) renders inline or side-by-side diffs with
    syntax highlighting and word-level highlights.
  - Pierre Trees (`@pierre/trees`) provides file navigation with folders,
    keyboard selection, file icons, and change badges in both views.
  - Existing comment threads shown under their lines.
  - Click a line number to comment on either side. Reply to threads and change
    their status in both the activity timeline and the diff.
  - An update picker (compare base/update N → update M), a navigator, and
    change stats.
- **Commits:** commits grouped by update.
- **Entry points:** a "Deck" hub under Repos, and an "Open in Review Deck"
  item in the PR's action menu, which opens the hub with
  `?pr=<id>&repo=<id>`.
- **Changelog hub (Repos › Changelog):** the selected repository's git tags
  that follow the tag convention, as cards. Each card has an editable release
  description and a Changelog generated from the commits since the previous
  tag, grouped by conventional-commit type. **Releases** are the tags whose
  latest publishing pipeline run succeeded with artifacts. They list each
  artifact's files with sizes, sha256 digests read from `SHA256SUMS`, and
  downloads. Project settings › Review Deck › Changelog sets the tag
  convention and the publishing pipeline per repository. Terms are defined in
  `GLOSSARY.md`, and the design is in issue #24. This hub needs the
  `vso.build` scope, so existing installs need an admin to approve the update.

**Not yet:**
- **Complete/abandon, viewed-file state, auto-complete, merge options:** milestone 3.
- **Work item linking, comment editing/deletion, likes.**
- **PR hub:** reviewer groups (teams) aren't expanded, so "Needs your review"
  only counts direct assignments. In Azure DevOps, checks and comment counts
  load lazily for visible rows, and size isn't shown. The host's browser
  Back button doesn't notify the iframe; use the breadcrumb.
- **Stack navigation:** later.
- **Syntax highlighting and "expand context".**
- **LLM titles and embeddings without the Azure Function** (heuristic titles
  and structural grouping only).
- **Remaining live validation:** cross-update and renamed-file comment positions,
  group identities, another reviewer's vote preservation, and real permission denials.

Version `0.1.5` is installed privately in `cabochons`. The
[live review of test PR #1](https://dev.azure.com/cabochons/Semantic_pr/_apps/hub/Cabochonio.semantic-pr-review.review-hub?pr=1&repo=d97ed793-6e2d-4caa-a2d5-f2387971e41a)
verified general and line comments, replies, resolving and reopening threads,
every vote option, reviewer search/add/remove/required controls, tags, and
description edits. Native PR data confirmed the saved results. The PR's original
description, empty reviewer list, and empty tags were restored. Three smoke-test
threads remain resolved.

Milestone 2 write checks used version `0.1.2`. Live testing exposed Azure DevOps reviewer PUT requests resetting omitted vote
or requirement fields. The adapter now reads the current reviewer and sends both
values. Reviewer search avatars also resolve against the organization URL.
All 37 startup, hub, editor, Pierre adapter, and mock regression tests pass. An injected HTTP 403 confirmed
that the installed page retains rejected drafts and displays the server error.
Actual organization permissions were unchanged. Test PR #1 has only one update
and one README edit, so it cannot establish cross-update or rename behavior.

Mock edits stay in memory for the current page session. Reloading the page resets
the mock. Every successful write reloads PR data without resetting the chosen diff
comparison or recomputing clustering. Failed writes keep the draft. If the write
succeeds but refreshing fails, the page asks for a refresh before another write.

New line comments carry the changed file's tracking ID and selected iteration
comparison. The Azure DevOps source asks the API to track existing threads into
that comparison. The mock displays newly anchored threads only in their original
comparison. Imported snapshot comments without iteration data retain their stored
line positions.

The milestone plan and remaining backlog are in [docs/milestone-2.md](docs/milestone-2.md).
Startup and Firefox regression checks are in [docs/startup-loading.md](docs/startup-loading.md).
Opening the Deck hub without a PR shows the inbox. Preferences still
work for the current session when browser storage is denied. The SDK handshake
runs before loading the review UI, and parsing/clustering code loads separately.

For browser failure checks, run `npm run ext:test:browser` while `npm run ext:dev`
is running, then open `http://127.0.0.1:5173/test-dist/index.html`. This renders the
actual app against a mock with test hooks on `window.reviewTest`. Set `failWrite`
or `failRefresh` to fail the next comment write or reload. Set `pauseWrite` to
pause a submission, then call `resume()` to complete it. `writes` and `analyses`
count submissions and diff analyses. The test page lives outside the packaged
`dist` folder.

**How it's built:**
- **Data:** `src/data/model.ts` defines the normalized view model; the
  `PrSource` implementations are `adoSource.ts` (Azure DevOps REST via
  `azure-devops-extension-api`) and `mockSource.ts` (snapshot JSON).
- **Diffing:** Azure DevOps doesn't return unified diffs, so
  `src/review/engine.ts` fetches both blob versions per changed file (16
  requests at a time), diffs them with jsdiff, and runs the shared pipeline.
- **Large PRs:** the page stays responsive however big the PR is.
  - Diffing and the pipeline run in a Web Worker (`dist/review-worker.js`,
    from `src/review/worker.ts`). If the worker can't start, they run on the
    page instead.
  - The worker sends the diff first, so the Files tab shows it A–Z while
    grouping runs.
    - Progress shows in the PR header and the sticky Files toolbar
    ("Grouping by concern… 42%"), with a progress bar above the list.
    - When grouping finishes after more than 2 s, a toast says so.
    - If you've scrolled into the A–Z list, the view doesn't switch under
    you. The toast and toolbar offer "Show grouped" instead.
  - Hunk cards, Pierre diffs and the navigator's group trees mount within
    1,500px of the viewport and unmount beyond 5,000px (`ui/LazyMount.tsx`).
    Placeholders keep the estimated or last measured height. Content holding
    focus or a non-empty comment box is never unmounted.
  - Hunks over 1,000 lines show a "Load diff" button unless they already have
    comments.
  - Measured on a synthetic 990-file, 3,090-hunk PR (`npx tsx
    scripts/build-huge-mock.ts`, then open !99999), Chrome on a desktop:

    | | Before | After |
    |---|---|---|
    | First diff on screen | 50 s | 2.4 s |
    | Grouped by concern | 50 s | 18 s |
    | Longest main-thread freeze | 26 s | 0.7 s |
    | Pierre diffs mounted | 3,090 | ~12 |
    | DOM nodes | 41k | 6.7k |
    | JS heap | 722 MB | 136 MB |

  - `npm run bench -- <snapshot>` times the pipeline in Node and prints a
    fingerprint of its output. Optimizations must keep the fingerprint
    unchanged.
- **UI:** React 16 plus `azure-devops-ui` (Microsoft's own component
  library). The framework-neutral APIs of `@pierre/diffs` and `@pierre/trees`
  mount inside React wrappers. React portals attach comments, composers, and
  pending drafts to Pierre's line annotations without losing review context.
  Pierre's unused React bindings have scoped peer overrides to the host's
  React version. Import the package roots, not `/react`.
- **Highlighting:** Shiki's JavaScript engine and selected grammar chunks ship
  in the extension. TS/TSX, JS/JSX, JSON/JSONC, Markdown, CSS, HTML, YAML, and
  shell scripts have syntax highlighting. Other files render as text.
  Pierre loads when the Files tab opens. No highlighting assets use a CDN.
  Highlighting still runs on the page, as each diff mounts.
- **Theme:** colors come from the host's theme variables (`SDK.init({
  applyTheme: true })`), so dark mode follows Azure DevOps.

**Stacked PRs:** PRs that target another PR's branch form a stack. The PR page shows
it (a stack bar under the header, plus a Graphite-style panel in the Overview sidebar), and hub rows
show their position (`2/4`). Trunk branches (`main`, `dev`, `uat`, `*/00-*` …) are set per
project. With the backend, **auto-restack** rebases the layers above a changed or merged PR on the
server and retargets them. Setup and limits are in [docs/stacks.md](docs/stacks.md). Locally,
`npx tsx scripts/build-stack-mock.ts` turns demo PRs into stacks.

**CI publishing:** `.github/workflows/extension.yml` runs both typechecks, the
extension tests and a build on every push and pull request.
- On `main`, it also publishes the extension privately and shares it with the
  `cabochons` organization.
- Each upload is version `major.minor.<run number>`; major.minor comes from
  `vss-extension.json`. Bump major.minor there to start a new line.
- Publishing needs the `MARKETPLACE_TOKEN` repository secret: a Marketplace
  personal access token with *Marketplace › Manage* on *All accessible
  organizations*. Without it, the run still uploads the `.vsix` as an artifact.

**Installing in an organization:**
1. Create a publisher on the Visual Studio Marketplace.
2. Put its ID in `extension/vss-extension.json` and run `npm run ext:package`.
3. Upload the `.vsix` as a private extension, share it with your
   organization, and install it.
4. Open a PR, then choose ⋯ → "Open in Review Deck".

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
| `src/title/` | `Titler` interface. `HeuristicTitler` (default) recognizes renames (`X → Y` substitution in most hunks), moves (decl removed in one file, added in another), and doc-only groups. Otherwise it names the group's hub symbol, i.e. the non-test hunk with the most link weight. `src/node/llmTitler.ts` sends one prompt per PR, with its title and description, to `claude -p` / `codex exec`. The model orders the groups as a story for the reviewer and names each step. It returns a JSON array in reading order. The titler falls back to heuristics per group on any failure. |
| `src/render/html.ts` | Self-contained page; diff2html renders the diffs (server-side, so the page needs no diff JS). |
| `src/pipeline.ts` | Orchestration. When an LLM titler picks a reading order, the semantic groups follow it. |
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
