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
3. The PR page keeps the last 10 PRs opened in this browser (`data/prCache.ts`, `localStorage`). The 10 count across organizations, projects and users, with at most 1.5M characters in all. A PR over 500K characters isn't kept. A kept PR is ignored after a month (12 hours until November 3, 2026), like the hub cache, and deleted at the next save. The limits leave room in the origin's few MB for the hub's rows and pending review drafts. Opening a kept PR shows it at once, with the hub's progress bar under its header, and replaces it when the load lands. Until then its buttons are disabled, so no vote or completion is made from out-of-date data. If the load fails, the kept copy stays, marked as possibly out of date with a "Try again" link, as the hub keeps its rows. The guided view starts from the kept copy's latest update and moves to a newer one if the load shows one was pushed since.

The harness now plays this part of Azure DevOps too. Its REST stub returns one pull request, and runs over HTTP/2 on a second origin with CORS preflights, as `dev.azure.com` does (it falls back to HTTP/1.1 without `openssl`, which queues requests six at a time). The "slow REST" scenario answers every call after 400 ms. `prReact` is when the PR's page shows with its data, kept or loaded, and `prLive` when its buttons work, meaning the load has landed.

Medians of 9 runs, in ms from navigation start. "Cold" means a first visit; "warm" is a second visit, which reopens the PR.

| Scenario | Before: prReact / prLive | After: prReact / prLive |
| --- | --- | --- |
| PR link, REST at 0 ms, cold | 381 / 381 | 314 / 314 |
| PR link, REST at 0 ms, warm | 146 / 146 | 122 / 153 |
| PR link, REST at 400 ms, cold | 784 / 784 | 677 / 677 |
| PR link, REST at 400 ms, warm | 549 / 549 | 125 / 560 |

The harness didn't measure the hub's hover prefetch, because its stub listed no pull requests then (it lists 20 since November 4, 2026). Its pull request also had no changed files then (it has two since November 3, 2026), so the guided view built from the kept copy cost next to nothing there. On a real PR, that build's REST calls (the update's changes, then file contents) start with the kept copy and run alongside the seven loads, so in Azure DevOps the warm `prLive` may land somewhat later than the table shows. Hovering rows while the wheel scrolls them under a still pointer can also start prefetches for PRs nobody opens. Each costs seven REST calls, and only after 80 ms on one row.

## The page draws after two calls, not seven (November 3, 2026)

The PR page used to leave its skeleton once all seven REST calls had answered (the PR, its updates, threads, commits, tags, work items and policies), so the slowest call set the pace. The calls are uneven. On cabochons each takes 250 to 520 ms, and the threads of a long discussion or a long list of commits take more, because the answer is big. The seven still start together, but the page now draws in two stages (`data/adoOverview.ts`):

1. Once the PR and its updates are in, the page shows the title, description, status, author, branches, reviewers and the updates in the timeline. Checks, tags, work items, the comments and votes in the timeline, and the Commits tab say they're loading. The overview is marked `partial`; it's never kept in the browser, and the buttons wait, as they do while the kept copy shows (`stale`), with the progress bar under the header. The Files tab's build starts here, from the latest update, so it no longer waits for the heavy calls either.
2. Once the rest is in, the whole overview replaces it and the buttons work. If the rest fails, the partial page stays with a "Could not finish loading" box and a "Try again" link, as the kept copy does.

Opened from the kept copy, the page skips the partial. The kept copy is complete, and the partial would take its comments away for a moment. The local mock answers at once, so it loads in one stage.

The harness got two more PR scenarios. "Uneven REST" answers each call after 250 ms plus up to 270 ms at random (`?jitter=`), as the measured calls vary; "slow threads" answers the threads and commits after 900 ms and the rest after 300 ms (`?heavy=`), as a long discussion does. Medians of 9 cold runs (a first visit, nothing kept), in ms from navigation start; the skeleton shows at about 175 ms in all of them. `prReact` is when the page shows with its data, partial or whole, and `prLive` when the buttons work.

| Scenario | Before: prReact / prLive | After: prReact / prLive |
| --- | --- | --- |
| PR link, REST at 0 ms | 271 / 271 | 256 / 259 |
| PR link, REST at 400 ms | 660 / 660 | 652 / 656 |
| PR link, uneven REST (250 to 520 ms) | 736 / 736 | 641 / 728 |
| PR link, slow threads (300 ms; threads and commits 900 ms) | 1152 / 1152 | 562 / 1127 |

With every call answering alike there's nothing to gain, and `prLive` stays where it was in every scenario, because the whole still takes the slowest call. What changes is how long the skeleton stays, about 90 ms less when the calls are merely uneven, and 590 ms less when the threads are slow. The "uneven" numbers are one draw of random delays per run, so a rerun moves them by tens of milliseconds. What the real Azure DevOps calls look like on a PR with a long discussion hasn't been measured; the slow-threads scenario is the assumption this change rests on, and the partial costs nothing when it doesn't hold.

`npm run ext:timing -- --shots .cache/shots` now also takes `3-pr-partial.png`, the page between the two stages.

## Blobs in one call, and kept in the browser (November 3, 2026)

After the overview, the Files tab's wait was the blobs, with two REST calls per changed file (both sides), sixteen at a time, each 250 to 500 ms on Azure DevOps, so a 40-file PR's diff waited about two seconds and a 300-file one most of a minute. Now (`data/blobs.ts`):

1. Blobs this browser read before come from IndexedDB (`data/blobCache.ts`). A blob's id is its content's hash, so a kept blob is never stale; they age out after 30 days, and a blob over 1M characters isn't kept. The cache is per organization and user, like the other caches. A PR opened again, its next update (most files unchanged) or another PR on the same base skips the reads for what it has.
2. The rest come in one zip call per 200 blobs (`getBlobsZip`, up to four calls at once), read with the browser's `DecompressionStream`. A 40-file PR is one call.
3. A blob the zip didn't carry is read on its own, as before. If a zip ever comes back with entries not named by blob id, zipping stops for the page and every blob is read on its own, so the worst case is one wasted call. The build's `review built` log line says how many blobs came from each source.

Neither the hub cache nor the kept PR copies are involved. The cache holds file contents only. Not measured against Azure DevOps from here (no organization reachable); the expected effect follows from the call count, one round instead of files ÷ 8, and the harness's REST stub had no files to time it with (it has two since the next section).

Kept hub rows and PR copies also live a month now instead of 12 hours. Nothing acts on them (buttons wait for the load, the list refreshes at once), so the limit only guards a refresh that fails, and that case now says how old what's on screen is.

## The Files tab's reads start with the prefetch (November 3, 2026)

A link straight to a pull request starts the page's seven REST calls as soon as the route is known (`AdoHost.prefetchPr`, from `src/index.ts`), but the Files tab's two reads, the latest update's changes and then both sides of every changed file, started well after the page had drawn. They ran in the page's React effect, which runs once the partial is on screen and then waits for the analysis engine's chunk and for the backend and project settings. Those two settings are extension data, a REST round trip each in Azure DevOps, so the reads followed the partial by about one round trip. They now start in the prefetch itself, as soon as the PR and its updates are in (`AdoPrSource.prefetch({ files: true })`), and the build takes them over (`data/fileReads.ts`):

1. Whichever asks first starts a read, the prefetch or the build, and the other takes it instead of reading again. The prefetch's reads stay until the build takes them; a build's own read is forgotten once it settles, so nothing accumulates. A read that failed is forgotten too, so the build tries again and reports it. A build cancelled while holding a read (another comparison picked, the page left) stops what's left of it, as nobody else will take it. A build cancelled while it waits for the prefetched changes stops the blobs read started for it as well.
2. Opened from the kept copy, the build starts at mount from the copy's latest update and reads for itself. The prefetch then starts nothing the build has already asked for, even once the build's reads are done. If a push since then moved the latest, the prefetch's reads for the new one wait until the page moves to it.
3. Only a link straight to the PR asks for the files. A hovered hub row isn't always opened, and a zip call per hover would be too much, so the hover prefetch loads the overview only.

The harness's stub pull request now has one update that changes two files, whose contents its blobs zip call returns, and the hosted PR scenarios open on the Files tab and wait for the diff (`prDiff`, the first file header). A fifth scenario answers extension data after 400 ms as well (`?data=400`), as Azure DevOps does. Medians of 9 runs, in ms from navigation start; "warm" reopens the PR from its kept copy, whose build starts at mount.

| Scenario | Before: prReact / prDiff | After: prReact / prDiff |
| --- | --- | --- |
| PR link, REST at 0 ms, cold | 239 / 444 | 241 / 422 |
| PR link, REST at 0 ms, warm | 54 / 127 | 57 / 129 |
| PR link, REST at 400 ms, cold | 638 / 1654 | 644 / 1638 |
| PR link, REST at 400 ms, warm | 56 / 524 | 57 / 530 |
| PR link, uneven REST (250 to 520 ms), cold | 710 / 1700 | 727 / 1654 |
| PR link, slow threads (300 ms; threads and commits 900 ms), cold | 533 / 1341 | 546 / 1340 |
| PR link, REST and extension data at 400 ms, cold | 652 / 2044 | 650 / 1658 |
| PR link, REST and extension data at 400 ms, warm | 60 / 925 | 57 / 929 |

With extension data answering at once, all the reads had to wait for was the engine chunk's download, and the diff lands 15 to 45 ms sooner cold (the uneven scenario moves by that much between reruns anyway). With extension data at 400 ms, the case Azure DevOps is in, the diff lands 386 ms sooner. The reads no longer wait for the settings, which answer while the blobs are on their way. Warm visits don't change, as the kept copy's build starts at mount and its reads come first either way, and the diff then waits on the changes call, the blobs being kept in the browser. What the extension data calls cost on cabochons hasn't been timed from here; the 400 ms is the assumption the hub's "slow extension data" scenario rests on, and the change costs nothing where it doesn't hold.

## Fewer calls going back to the hub and opening a PR (November 4, 2026)

Every REST call to Azure DevOps takes 250 to 520 ms, and the hub made a burst of them on every visit. Each row's details take three calls, for its threads, policy evaluations and statuses (`ui/hub/rowDetails.ts`). The hub fetched them again after every list refresh, and it refreshes its list each time a PR page gives way to it. A hub of 20 rows so cost 3 list calls plus 60 detail calls per return. Those calls got in the way of the hover prefetch of the next PR and of that PR page's own calls, and they kept the "Updating…" bar on for seconds. The PR page's stack bar (`ui/stack/useStack.ts`) also listed the project's active and recent PRs on every PR open, three calls, to find whether the PR sits in a stack. Two changes:

1. A row's details are fetched again only in three cases. The last fetch is three minutes old (`DETAILS_FRESH_MS`, `ui/hub/detailsDue.ts`). The row's reviewers, their votes or its target branch changed in the new list, which its policy evaluations follow, so a vote that just landed moves your PR to Approved at once. Or the Refresh button asked for everything. Details the PR page patched in (`rememberPr`) count as fetched then, and a details answer that lands after such a patch is dropped. The hub saves when each row's details were fetched along with them, so a reload within three minutes of a fetch fetches none. The list's own age wouldn't do, because a list refresh keeps the details of rows it doesn't fetch again. With three minutes, a look at a PR and back costs no detail calls, and a return after a review of some minutes fetches them again. A build or a comment is at most three minutes late on a hub in use, which Azure DevOps' own list doesn't show at all. The decision is a pure function with its own test (`tests/details-due.test.ts`).
2. The stack bar takes the hub's kept list in place of its own when three things hold. It was listed within five minutes (`STACK_FROM_LIST_MS`, `data/hubCache.ts`). It lists the PR. Its repository choice took in the PR's whole repository, since a stack is PRs of one repository. A PR opened from a hub row meets all three, with a list as old as the stay on the hub. Otherwise, and on reload after a restack, the API answers as before. Five minutes rather than three, because stacks change when a PR is created, retargeted or closed, far less often than what the details track. The layers' details the hub kept show first, but each layer's are still fetched, three calls a layer, because the kept ones carry no age. There is no refresh in the background when the kept list is used. The hub lists again as soon as it's shown, so the stack is at most one hub visit old, and the point is to keep those calls out of the way of the PR's own.

The harness's REST stub now lists 20 pull requests for the hub (`PULL_REQUESTS`). 16 ask the user to review them, 4 are the user's own, and one is stacked on the PR the PR scenarios open. The stub returns each by id and logs every call it answers. `npm run ext:timing -- --calls` plays the round the hub is for, hub → PR → hub → another PR → hub, in a window tall enough for all 20 rows. It counts each step's calls once the step has been quiet for 600 ms. The table gives medians of 3 rounds, the same in every round. "Warm" is a second round in the same profile, where the hub starts from its kept rows and the PRs from their kept copies.

| Step | Before | After |
| --- | --- | --- |
| Hub, first visit (nothing kept) | 70 | 70 |
| PR 471 (stacked) opened from its row | 19 | 16 |
| Hub, back from the PR | 64 | 4 |
| PR 454 (not stacked) opened from its row | 13 | 10 |
| Hub, back from the PR | 64 | 4 |
| Warm: hub reloaded with its kept rows | 94 | 6 |
| Warm: PR 471 (stacked) opened from its row | 20 | 17 |
| Warm: hub, back from the PR | 64 | 4 |

The first visit's 70 are the list (3), the project picker's catalog (2), the user's teams (1) and the 20 rows' details (64). The details are 64 rather than 60 because the 4 own rows are asked for their policies first, then in full. A return now costs the list and the teams, and the 60 detail calls are gone. A PR open no longer lists the project, which saves 3 calls whether the PR is stacked or not. A stacked PR still fetches its two layers' details, 6 calls. The PR page's own 10 stay. They are the PR, its updates, threads, commits, tags, work items and policies, its repository, the latest update's changes and the threads for the Files tab. A reload of the hub used to cost 94, because the kept rows' details were fetched before the list landed and the listed rows' again after.

These counts come from the stub, not from Azure DevOps, which isn't reachable from here. The app makes the same calls there, each 250 to 520 ms. The hub's progress bar also used to stay on, unseen, when a details request landed while a PR page covered the hub. The round's quiet check found that, and it's fixed. The timing scenarios run against the same stub. The hosted PR ones land where the previous section measured them, with medians of 5 for `prReact` / `prLive` at 255 / 258 ms at REST 0 ms and 564 / 1133 ms with slow threads. The hosted hub, with rows to show at last, settles at 311 ms cold and 89 ms warm.

## Measure startup

Build first, then run the harness. It serves `extension/` itself and needs Chrome (`--chrome <path>` if it isn't under Program Files; on a Mac, `--chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`), plus `openssl` (Git for Windows has it) for the HTTP/2 REST stub.

```powershell
npm run ext:build
npm run ext:timing                                   # all scenarios, 5 runs each
npm run ext:timing -- --only "hosted hub" --runs 10 --latency 40
npm run ext:timing -- --shots .cache/shots           # screenshots of the skeletons and loaded pages
npm run ext:timing -- --check                        # a PR whose threads fail isn't kept in the browser
npm run ext:timing -- --root .cache/baseline         # another build, e.g. main's dist copied there
npm run ext:timing -- --calls --runs 3               # REST calls per step of hub → PR → hub, not timings
```

Measure a production build: `npm run ext:dev` rewrites `extension/dist` as an unminified development bundle, which parses markedly slower. When a landmark never appears, the harness fails with the page's text, its pending requests and console errors.

## Warming the backend at page load (November 3, 2026)

A Windows Consumption function that sat idle for about 20 minutes cold-starts on its next request. Measured against the backend named in `infra/terraform.tfvars` without its key, so everything but the model load: 3.3 s for the first request after a quiet spell, 0.36 s for the next. The model (`backend/src/embed.ts`) loads in 0.1 s on an M2 Pro and takes a second or two more on the function's shared worker. The page used to call `/api/warm` when the guided view's build started, after the PR's REST calls had answered, and the embed call then waited for the rest of the cold start once the blobs were in.

`renderHost` (`src/page.tsx`) now warms the backend as the review hub or a PR page opens, after the handshake and without waiting on it (`review/backend.ts` warmBackend). A direct link sends it about half a second earlier than before. A PR opened from the hub finds the backend warm after a few seconds spent in the list. Nothing is sent when the organization has no backend, nor when its settings (the same read that decides whether the hub shows at all) say the Deck is off for the project: a link to a turned-off hub leaves the function asleep. The timing harness doesn't cover it, because its host has no backend.
