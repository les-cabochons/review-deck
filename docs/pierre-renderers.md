# Pierre diff and file tree

Replace the demo and extension's custom diff table and file navigator with `@pierre/diffs` and `@pierre/trees`.

## Plan

1. Pin the renderer versions and use their framework-neutral DOM APIs. The host remains on the React version supported by Azure DevOps UI. Keep any peer override limited to the unused Pierre React bindings.
2. Adapt our hunks to Pierre patch metadata without changing the old/new line numbers, file paths, or semantic groups.
3. Render comments, review drafts, and new comment composers as line annotations. Preserve both diff sides, inline/split mode, stale-comparison protection, and pending-review behavior.
4. Use Pierre file trees for alphabetical navigation and for files within each semantic concern. Preserve concern order and group jump controls.
5. Bundle highlighting assets locally, preserve host light/dark themes and full width, and keep heavy rendering code out of startup.
6. Check anchors and lifecycle cleanup with focused regressions. Exercise the real demo in Chrome and Firefox, including navigation, modes, comments, drafts, and themes. Update the README and package the extension.

## Backlog

- [x] Install compatible pinned dependencies.
- [x] Replace diff rendering and annotations.
- [x] Replace file navigation.
- [x] Verify browser behavior and regression checks.
- [ ] Update documentation and package the extension.

The standalone HTML report pipeline continues to use diff2html. This migration applies to the interactive demo and Azure DevOps review page.
