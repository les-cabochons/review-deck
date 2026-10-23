# Startup loading and browser compatibility

## Reproduction

Opening the Repos Deck hub without `pr` and `repo` parameters throws after the SDK handshake. The error renders inside the hidden iframe, but the host receives neither success nor failure, so its loading spinner never clears. Reproduced in the installed Chrome session and in Firefox with the real bundled entry point and a local host handshake.

## Implementation plan

1. Initialize the host connection before loading the review UI and data adapters. Render a useful empty state for the bare hub. Notify the host after rendering either that state, the loading page, or a startup error. Bound host initialization and query lookup so missing replies produce an error.
2. Treat saved view preferences as optional. Storage denial must not prevent rendering or changing views.
3. Split the semantic analysis engine out of the entry bundle. Load it when analysis starts, so the host handshake and PR overview do not wait for parser and clustering code to download.
4. Add startup/browser regressions for missing PR parameters, failed host setup, and blocked storage. Run them in Firefox and Chrome. Compare production entry sizes and startup timings before and after the change.
5. Publish the verified private update in cabochons, check the bare hub and test PR, and record the limits of Firefox validation.

## Backlog

- [x] Fix the empty hub loading loop and signal startup failures.
- [x] Keep preferences usable when browser storage is denied.
- [x] Reduce code downloaded before the host handshake.
- [x] Verify local Firefox and Chrome startup regressions.
- [x] Validate the updated private installation.

No PR write actions are needed for this fix.

## Verification

- `playwright-cli -s=semantic-firefox run-code --filename=.cache/startup-repro.js` failed before the fix with `Bare hub error never dismisses host spinner`. The installed Chrome hub had the same hidden missing-parameter error.
- A second Firefox reproduction denied access to `window.localStorage`. Rendering failed with `SecurityError: Storage access denied`. The fixed page also tolerates denied storage methods and quota errors.
- All 26 Node regression tests and both typechecks pass. The production build and private `0.1.5` package pass. Serialized host errors retain their message.
- `extension/tests/startup.browser.js` exercises the packaged entry point with a host handshake, empty parameters, a rejected navigation service, and blocked storage. Firefox and Chrome pass. Both render semantic diffs, switch to split mode and alphabetical order, and load the packaged stylesheet.
- The empty hub now completes in about 170 to 260 ms on the local test server. Previously it never completed. These timings measure the local host reproduction, not Azure DevOps network latency.
- Production `review.js` fell from 524,106 to 2,261 bytes. The UI is a separate roughly 314 KB chunk and the analysis engine is roughly 189 KB. SDK/shared chunks and CSS also load before the handshake. The empty hub does not request UI, analysis, or WASM files.
- Production builds clear only the generated `extension/dist` directory before bundling. Older hashed chunks no longer accumulate in the VSIX.

Automated Firefox checks use a local host simulation and real bundled code. Alex also confirmed that reloading the signed-in Firefox session clears the stuck spinner and the page loads. The automated diff checks and this live startup confirmation cover different behavior.

Version `0.1.5` passed Marketplace verification and is installed privately in `cabochons`. The signed-in Chrome session confirms that the bare hub displays its guidance without the host spinner and its repository link navigates the host. Test PR #1 loads the overview and diff without application errors, with the stylesheet applied. One live navigation took about 2.9 seconds to show the overview and 4.9 seconds to finish the diff. This includes Azure DevOps navigation and network calls and is not a controlled performance benchmark.

Alex confirmed the live Firefox startup fix on October 12, 2026.

## Skeleton-first startup (October 22, 2026)

The hub used to sit behind the host's spinner until the UI had downloaded (after the handshake), the user's synced preferences had been read (up to 1.5 s) and React had rendered. Now the page paints before any script runs, and the spinner ends right after the handshake:

1. `dist/review.html` carries the hub's skeleton inline, the theme the host sent last time (so a dark-theme user's skeleton is dark before the handshake) and `modulepreload` links for every chunk the first render needs. `extension/build.mjs` fills these in from `src/skeletons.ts` and the bundle's metafile. The module script comes before the preloads, so the handshake code is fetched first; `src/index.ts` also starts the UI imports before the handshake.
2. `src/startup.ts` calls `notifyLoadSucceeded` right after `SDK.init`, before rendering. A failure after that shows on the page itself, with a reload button, instead of in the host's error state.
3. Once the route is known, a link straight to a pull request swaps in that page's skeleton. React's `PrSkeleton` then fills in the title, status, author and branches from the hub cache while the real data loads.
4. Synced preferences never delay the first paint: the page opens with this browser's values, and the hub adopts the user's (`preferencesLoaded`) when they arrive, unless the user already changed them here.
5. The hub cache lives in `localStorage`, so a new tab also starts from the last list. The list no longer waits for the starred repositories unless the selection includes them.

Medians of 5 runs in headless Chrome against a local server that adds 30 ms to every response (`npm run ext:timing`), in milliseconds from navigation start. "Loaded" is when the host receives `notifyLoadSucceeded` (its spinner ends), "skeleton" when the page shows its layout, "React" when the real UI has rendered.

| Scenario | Before: loaded / skeleton / React | After: loaded / skeleton / React |
| --- | --- | --- |
| Hub, cold cache | 309 / 303 / 303 | 104 / 47 / 209 |
| Hub, warm cache | 106 / 99 / 99 | 59 / 11 / 81 |
| PR link, cold cache | 300 / 297 / – | 107 / 47 (PR skeleton at 128) / – |
| PR link, warm cache | 74 / 71 / – | 60 / 12 (PR skeleton at 61) / – |
| Local hub, cold cache | – / 430 / 430 (rows 492) | – / 54 / 300 (rows 359) |
| Local hub, warm cache | – / 101 / 101 (rows 166) | – / 17 / 92 (rows 152) |

The stub API had no pull request then, so the hosted PR scenario ended on the page's error box (it returns one since the next section). Azure DevOps adds its own latency to the handshake and to every REST call, which the skeleton and the host notification no longer wait for.

The hub also no longer waits for the organization's on/off setting for it (`renderUnlessOff` in `src/startup.ts`). That setting is extension data, a REST round trip, and the cached rows used to wait behind it on every load, including a reload after going back from a PR. The page now renders at once and gives way to the "turned off" notice if the setting says so. It waits only where the hub was off last time in this browser, so a turned-off hub doesn't flash its rows. With extension data answering after 400 ms (`/host?data=400`, the "slow extension data" scenario), the warm hub's React UI with its cached sections went from 497 / 525 ms (React / settled) to 107 / 166 ms. Cold, it went from 595 / 624 to 282 / 324.

## Opening a pull request (October 23, 2026)

Once the skeleton was fast, the PR page still showed it for about a second where Azure DevOps' own PR page is close to instant. Almost all of that is Azure DevOps' REST latency. The page shows the PR once seven calls answer (the PR, its updates, threads, commits, tags, work items and policies). Timed with `curl` against `cabochons`, each took 250 to 520 ms, even the ones that return 22 bytes, so the slowest of the seven sets the pace. Ahead of the first call, the host has to issue the extension's token and resolve each API's location. Each URL also needs a CORS preflight the first time (about 65 ms, then cached for an hour), because the page runs on the Marketplace CDN's origin. The CDN serves the page's files gzipped with a one-year cache, and `dev.azure.com` speaks HTTP/2, so neither the files nor connection limits are the bottleneck.

The page can't make those calls faster, so it starts them sooner or doesn't wait for them:

1. A link straight to a PR starts loading it as soon as the route is known (`AdoHost.prefetchPr`, from `src/index.ts`). The calls, and the token and location lookups ahead of them, then overlap loading and rendering the UI instead of following it.
2. In the hub, a row the pointer rests on for 80 ms, or presses, starts loading its PR, so the wait overlaps the move to the click. The PR page takes that load if it is under 15 seconds old, and a prefetch that failed is tried again. Opening a PR before the 80 ms are up (Enter, a quick click) cancels the pending prefetch.
3. The PR page keeps the last 10 PRs opened in this browser (`data/prCache.ts`, `localStorage`). The 10 count across organizations, projects and users, with at most 1.5M characters in all. A PR over 500K characters isn't kept. A kept PR is ignored after 12 hours, like the hub cache, and deleted at the next save. The limits leave room in the origin's few MB for the hub's rows and pending review drafts. Opening a kept PR shows it at once, with the hub's progress bar under its header, and replaces it when the load lands. Until then its buttons are disabled, so no vote or completion is made from out-of-date data. If the load fails, the kept copy stays, marked as possibly out of date with a "Try again" link, as the hub keeps its rows. The guided view starts from the kept copy's latest update and moves to a newer one if the load shows one was pushed since.

The harness now plays this part of Azure DevOps too. Its REST stub returns one pull request, and runs over HTTP/2 on a second origin with CORS preflights, as `dev.azure.com` does (it falls back to HTTP/1.1 without `openssl`, which queues requests six at a time). The "slow REST" scenario answers every call after 400 ms. `prReact` is when the PR's page shows with its data, kept or loaded, and `prLive` when its buttons work, meaning the load has landed.

Medians of 9 runs, in ms from navigation start. "Cold" means a first visit; "warm" is a second visit, which reopens the PR.

| Scenario | Before: prReact / prLive | After: prReact / prLive |
| --- | --- | --- |
| PR link, REST at 0 ms, cold | 381 / 381 | 314 / 314 |
| PR link, REST at 0 ms, warm | 146 / 146 | 122 / 153 |
| PR link, REST at 400 ms, cold | 784 / 784 | 677 / 677 |
| PR link, REST at 400 ms, warm | 549 / 549 | 125 / 560 |

The harness doesn't measure the hub's hover prefetch, because its stub lists no pull requests. Its pull request also has no changed files, so the guided view built from the kept copy costs next to nothing there. On a real PR, that build's REST calls (the update's changes, then file contents) start with the kept copy and run alongside the seven loads, so in Azure DevOps the warm `prLive` may land somewhat later than the table shows. Hovering rows while the wheel scrolls them under a still pointer can also start prefetches for PRs nobody opens. Each costs seven REST calls, and only after 80 ms on one row.

## Measure startup

Build first, then run the harness. It serves `extension/` itself and needs Chrome (`--chrome <path>` if it isn't under Program Files), plus `openssl` (Git for Windows has it) for the HTTP/2 REST stub.

```powershell
npm run ext:build
npm run ext:timing                                   # all scenarios, 5 runs each
npm run ext:timing -- --only "hosted hub" --runs 10 --latency 40
npm run ext:timing -- --shots .cache/shots           # screenshots of the skeletons and loaded pages
npm run ext:timing -- --root .cache/baseline         # another build, e.g. main's dist copied there
```

Measure a production build: `npm run ext:dev` rewrites `extension/dist` as an unminified development bundle, which parses markedly slower. When a landmark never appears, the harness fails with the page's text, its pending requests and console errors.
