# Review controls

Implement the requested Files tab changes locally, then verify the actual mock review page before release.

## Plan

- Remove repeated concern number chips from alphabetical file headers.
- Remove modified file badges from both views. Show small Created and Deleted pills after the file path only for added and deleted files.
- Add a fold chevron to every file header in both views. Deleted files start folded. A file's fold is shared across views and cards and survives lazy mounting; picking a file in the tree unfolds it. Ticking Viewed folds the file and unticking unfolds it, like GitHub; viewed files start folded after a reload. Concerns follow the same rule: ticking a concern's Viewed folds it, and a concern whose files are all viewed starts folded. Chunks don't fold on their own: no other diff viewer does, and a chunk-header click reads as "show the file".
- Add a GitHub-style Viewed checkbox to file headers and concern headers. Concern controls mark all unique files in the concern, with a mixed state when only some are viewed. Shared files use one viewed state across concerns.
- Replace the existing toolbar file counter with viewed / total viewed, followed by the existing added and removed line counts. Always show it, even at zero, independent of filters.
- Show a check and Viewed tooltip beside viewed files in both file trees.
- Save viewed state locally per repository, PR, user and comparison. Invalidate a file's check when either blob changes.
- Add a Comment button to every file header for comments on the whole file (Azure DevOps file threads: a file path with no line positions). In the concern view, a file's comments show on its first card. Drafts join the pending review like line comments.
- Add a ⋯ menu to every file header with "View file", which opens the file at the compared update's head commit (the compared-from commit for deleted files).
- Add a separate chevron to collapse each concern's sidebar file tree. Keep the title's diff jump and retain collapse choices during search, filtering, view switches and sidebar visibility changes.

## Backlog

- [x] Inspect existing renderers, preferences and navigation.
- [x] Remove repeated concern chips.
- [x] Replace chunk folding with file folding (`extension/tests/file-collapse.browser.js`).
- [x] Fold files and concerns when marked Viewed (`extension/tests/viewed-fold.browser.js`).
- [x] Replace file letter badges with Created and Deleted pills.
- [x] Implement shared viewed state, progress and tree indicators.
- [x] Verify persistence, comparison isolation, shared files and group mixed state.
- [x] Verify concern/alphabetical and inline/side-by-side views in the local browser.
- [x] Add accessible sidebar group collapse controls.
- [x] Verify sidebar collapse controls, retained choices and existing group/file navigation.
- [x] Add file comments and the View file menu; verify both in the local browser (`extension/tests/file-comments.browser.js`).

Publication and installation are separate from this local change.

## Verification

The extension's 90 tests and both TypeScript checks pass. Each browser check runs with `playwright-cli run-code --filename=<file>` against the local mock (`/dev/?pr=17901&repo=t3code#files`), not the installed Azure DevOps extension:

- `review-controls.browser.js`: shared file state, concern mixed state, tree indicators, retained folder expansion, file folding across views, the merged counter, and local persistence.
- `nav-groups.browser.js`: sidebar concern folding by mouse and keyboard, retained choices, concern jumps and file selection.
- `file-comments.browser.js`: posting a file comment and the View file link.
- `file-collapse.browser.js`: deleted files start folded; folding works in both views.
- `viewed-fold.browser.js`: Viewed folds files and concerns, ticking files one by one leaves the concern open, and a viewed concern is still folded after a reload.

An earlier check confirmed reload persistence and isolation between Update 1 and Update 2, and identical vertical centers for the light and dark counter.
