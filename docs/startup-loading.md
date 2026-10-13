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

## Run browser regressions

Build with `npm run ext:build` and run `npx esbuild --servedir=extension --serve=127.0.0.1:5173` in a terminal. Mock snapshots must exist; generate them with `npm run ext:mock` if needed.

```powershell
npx --yes --package @playwright/cli playwright-cli install-browser firefox
npx --yes --package @playwright/cli playwright-cli -s=startup-firefox open about:blank --browser firefox
npx --yes --package @playwright/cli playwright-cli -s=startup-firefox run-code --filename=extension/tests/startup.browser.js
npx --yes --package @playwright/cli playwright-cli -s=startup-firefox close
```

Use `--browser chrome` and a separate session name to run the same checks in Chrome.
