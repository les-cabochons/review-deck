# The generated description

The description card in Overview has a toggle: **Written by \<author\>**, and **Generated**. It always opens on the author's description. The generated one describes the pull request from what Review Deck reads, so a reviewer can compare it with what the author wrote. The goal is for it to replace the written description one day. It isn't there yet: see [What it can't know](#what-it-cant-know).

## What it shows

- **Why.** The commit messages, as a changelog: subjects grouped by conventional-commit type, like the Changelog hub (`buildChangelog` in `extension/src/data/releases.ts`). Merges from the target branch are left out by their subject, because the PR's commits don't say how many parents they have.
- **What changed.** A map of the guide's concerns, in columns: concerns on the left define names, and each column to the right uses names from the columns before it. A square connector joins a concern to one that uses it, with the arrowhead on the user's side, at both ends when each uses the other. The text over a connector is a name used. Each card has its count of added and removed lines, and five squares for their share. Concerns without a link sit apart, under "On their own". On a phone the map doesn't show: the list below says the same.
- **How they connect.** The same, in sentences, per concern: what it uses from which concern, which concerns use it, and "reviewable on its own" when nothing links it. This is what a screen reader and a phone get.

In **Files**, a concern of three changes or more whose changes use each other's names shows **How these changes connect** (`src/relations/flow.ts`):

- One card per function and file. Changes inside the same function of the same file share a card, so a large function edited in twelve places is one card, not twelve cards with its name.
- Every card reads the same way: the function as its title, then its file, the number of changes past one, and its added and removed lines.
- Same columns and connectors as the map of concerns (`src/relations/diagram.ts`). A connector that spans a column passes between the cards, never over one. A use that closes a cycle is drawn back to front, its arrowhead on the left.
- A connector's text gives only the names the cards don't already show: no `StorageCleanup` on a connector from the card `StorageCleanup`.
- On a phone, the same links show as an outline (`FlowOutline.tsx`): each function that uses others, then one row per thing it uses. Nothing to lay out, so it never scrolls sideways.
- Past 12 cards, a line gives the count instead of a map nobody can read. The outline has no such limit.
- Clicking a card shows only its changes. Clicking a connector, or a row of the outline, shows only the changes behind it: for each name it stands for, the change that defines it and the change that uses it (`arrowHunks` in `src/relations/flow.ts`). A line above the changes says what is picked, with Show all. Clicking the same card or connector again also shows them all. The changes left out are hidden, not removed, so a comment being typed on one of them is kept. Going to a hidden change from the navigator or a comment's link shows them all again.

## Moving around a diagram

Every diagram, these and the Infra tab's, sits on a canvas the reader moves like draw.io (`extension/src/ui/relations/DiagramCanvas.tsx`):

- Press anywhere and drag to move it. A press that doesn't move clicks what is under it, so cards and connectors still work.
- Ctrl (or ⌘) and the wheel, or a trackpad pinch, zoom around the pointer. The plain wheel still scrolls the page.
- The −, + and Fit buttons zoom around the middle and put it back. With the canvas focused, the arrow keys move it, + and − zoom, and 0 fits it.
- Tabbing to a card the canvas has moved out of sight brings it back in.
- It opens fitted to its width, never below 75%. Part of it always stays in sight, however far it is dragged.

## Reading and hiding the diagrams

- **How to read it**, beside each diagram, opens a full explanation above it: what a card and a connector mean, how to use the map while reviewing, and what it can't tell (`extension/src/ui/relations/HowToRead.tsx`).
- **Hide diagrams** hides every diagram, in Overview and in Files, on every pull request. The choice is saved with the user's preferences, so it follows them to other browsers (`diagramsShown.ts`). The list of how concerns connect stays.
- **Show change diagrams**, in the Files tab's settings menu (the gear), brings them back. The same menu has **Hide change diagrams** while they show.

## Where the links come from

`src/relations` reads what the pipeline already records for each hunk: the names it defines and the names its changed lines use (`HunkInfo.defines` and `.references`). The guide's ordering used them, and dropped them. Now they are kept:

- **Between concerns**: a concern uses a name another concern defines.
- **Inside a concern**: the same, between its changes.

**Test files are left out.** A test calling the code it tests says nothing about how the change fits together, and it put test files in most maps.

Names are matched as text, like the grouping's structural signal. Two different things with the same name can look linked, which is why each link shows its names. One case is handled: a name defined in the user's own file resolves there, so `Layer.effect(StorageCleanup, make)` links to its own file's `make`, never to a `make` in another file.

**Loose matches** are links that rest only on member names (`.hide`, `.files`). A member name matches on whatever object it is on, so these are often wrong. They aren't drawn, and the list puts them on one line per concern, said to be loose.

### Saved with the guide

The guide saves the relations (`SavedReview.relations` in `extension/src/review/saved.ts`), so everyone who reopens a comparison gets them without parsing again. The field is optional and the format stays 4:

- A guide saved before relations existed, or published by Ajour without them, restores without relations. The generated description lists its concerns, says the links weren't recorded, and points to Regroup. It never calls a concern unlinked when it doesn't know.
- Links to hunks or concerns that aren't in the diff are dropped on reading.
- Flows are capped at 40 links per concern and 300 per pull request, biggest concerns first, so a huge pull request's guide still fits its document.

## What it can't know

The page doesn't say these; reviewers compare it with the author's description:

- **How the change was tested.** Only the author knows. Test files in the diff are a partial answer.
- **What could break.** The Infra view covers Terraform. For code, nothing in the diff says so.
- **Why, beyond the commits.** Commits named "wip" or "fix" give a poor why. A model could write a better one: see below.

## Next

- **A why written by the backend's model**, for projects that opted in to AI titles: the PR title, commit messages, linked work item and concern titles in, a short why out, labelled with the model's name. Without the opt-in, the commits changelog stays.
- **The titles prompt reads the PR description as the author's intent.** Once descriptions are generated, it should read the commits and work item instead, so the model doesn't take its own words as intent.

## Checks

- `src/relations/tests/relations.test.ts`: the links, loose matches, the caps, reading saved relations, and the map's layout.
- `extension/tests/saved.test.ts`: relations survive a save, and an older guide restores without them.
- `extension/tests/generated-description.browser.js`: real T3 Code PR 17563 in the write harness (`npm run ext:mock`, `npm run ext:test:browser`, with `npm run ext:dev` running).
