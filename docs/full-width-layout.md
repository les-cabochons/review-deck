# Full-width review pages

Use the Azure DevOps content area's full width for Overview, Files, and Commits, with the existing page padding and sidebar widths.

The Azure DevOps UI stylesheet makes the body a flex container. The review root has no explicit width, so its content can determine its width. Overview and Commits also have maximum widths.

## Plan

- [x] Make the review root fill its containing page.
- [x] Remove the Overview and Commits page width caps.
- [ ] Verify all three tabs with a small PR and a wide viewport.
- [ ] Publish and verify the private extension update.

## Local verification

Chrome and Firefox both fill the available content width in all three tabs. At a 1920-pixel viewport, the root is 1920 pixels wide and each tab is 1856 pixels wide after the existing side padding. At 1280 pixels, those widths are 1280 and 1216 pixels. The production build, `0.1.6` VSIX packaging, and whitespace checks pass.

The page keeps its existing 32-pixel side padding, 300-pixel Overview sidebar, and 260-pixel Files navigator.
