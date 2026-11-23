# The generated description

The description card in Overview has a toggle: **Written by \<author\>**, and **Generated**. It always opens on the author's description. The generated one describes the pull request from what Review Deck reads, so a reviewer can compare it with what the author wrote. The goal is for it to replace the written description one day. It isn't there yet: see [What it can't know](#what-it-cant-know).

## What it shows

- **Why.** The commit messages, as a changelog: subjects grouped by conventional-commit type, like the Changelog hub (`buildChangelog` in `extension/src/data/releases.ts`). Merges from the target branch are left out by their subject, because the PR's commits don't say how many parents they have.
- **What changed.** A map of the guide's concerns. An arrow goes from the concern that defines a name to the one that uses it, both ways when each uses the other. A dashed line means only tests link them. Each arrow shows the name behind it. Concerns without a link sit apart, under "On their own".
- **How they connect.** The same, in sentences, per concern: what it uses from which concern, which concerns use it, which test it, where to start, and "reviewable on its own" when nothing links it. This is what a screen reader and a phone get.

In **Files**, a concern of three changes or more whose changes use each other's names shows **How these changes connect**: a map of those changes, with the one to start with marked. Clicking a change scrolls to it.

## Where the links come from

`src/relations` reads what the pipeline already records for each hunk: the names it defines and the names its changed lines use (`HunkInfo.defines` and `.references`). The guide's ordering used them, and dropped them. Now they are kept:

- **Between concerns**: a concern uses a name another concern defines. `tests` when the user is a test.
- **Inside a concern**: the same, between its changes.

Names are matched as text, like the grouping's structural signal. Two different things with the same name look linked, which is why each link shows its names.

**Loose matches** are links that rest only on member names (`.hide`, `.files`). A member name matches on whatever object it is on, so these are often wrong. They aren't drawn, and the list puts them on one line per concern, said to be loose.

### Saved with the guide

The guide saves the relations (`SavedReview.relations` in `extension/src/review/saved.ts`), so everyone who reopens a comparison gets them without parsing again. The field is optional and the format stays 4:

- A guide saved before relations existed, or published by Ajour without them, restores without relations. The generated description lists its concerns, says the links weren't recorded, and points to Regroup. It never calls a concern unlinked when it doesn't know.
- Links to hunks or concerns that aren't in the diff are dropped on reading.
- Flows are capped at 40 links per concern and 300 per pull request, biggest concerns first, so a huge pull request's guide still fits its document.

## What it can't know

The orange line at the bottom says it to the reader:

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
