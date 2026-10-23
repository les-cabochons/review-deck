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

The stub API has no pull request, so the hosted PR scenario ends on the page's error box. Azure DevOps adds its own latency to the handshake and to every REST call, which the skeleton and the host notification no longer wait for.

The hub also no longer waits for the organization's on/off setting for it (`renderUnlessOff` in `src/startup.ts`). That setting is extension data, a REST round trip, and the cached rows used to wait behind it on every load, including a reload after going back from a PR. The page now renders at once and gives way to the "turned off" notice if the setting says so. It waits only where the hub was off last time in this browser, so a turned-off hub doesn't flash its rows. With extension data answering after 400 ms (`/host?data=400`, the "slow extension data" scenario), the warm hub's React UI with its cached sections went from 497 / 525 ms (React / settled) to 107 / 166 ms. Cold, it went from 595 / 624 to 282 / 324.

## Measure startup

Build first, then run the harness. It serves `extension/` itself and needs Chrome (`--chrome <path>` if it isn't under Program Files).

```powershell
npm run ext:build
npm run ext:timing                                   # all scenarios, 5 runs each
npm run ext:timing -- --only "hosted hub" --runs 10 --latency 40
npm run ext:timing -- --shots .cache/shots           # screenshots of the skeletons and loaded pages
npm run ext:timing -- --root .cache/baseline         # another build, e.g. main's dist copied there
```

Measure a production build: `npm run ext:dev` rewrites `extension/dist` as an unminified development bundle, which parses markedly slower. When a landmark never appears, the harness fails with the page's text, its pending requests and console errors.
