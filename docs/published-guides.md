# Guides published from Ajour

Ajour's **Publish guide** writes a guide, and a summary of the change, to the same `saved-reviews` document Review Deck keeps for a pull request (`extension/src/review/saved.ts`). Review Deck shows it to everyone who opens that comparison, labelled "Published from Ajour". Issues: les-cabochons/ajour#777, decided in les-cabochons/ajour#600 and les-cabochons/ajour#662.

## The entry

A published guide is a format 4 `SavedReview` in the comparison's slot (`iteration`, `compareTo`), with two optional fields:

- `madeWith.app: "ajour"` marks it as published. Without it, the entry is Review Deck's own guide.
- `summary` is shown above the guide:

  ```ts
  summary?: {
    problem: { text: string; source: "ticket" | "inferred"; ticket?: { id: string; title: string; url: string } };
    kinds: ("breaking" | "feature" | "fix" | "refactor" | "performance" | "tests" | "docs" | "dependencies" | "build")[];
    breaking: { text: string; hunkIds: string[] }[];
    risks: { text: string; hunkIds: string[] }[];
    tests: { text: string; hunkIds: string[] }[];
    leftovers: { text: string; hunkIds: string[] }[];
  }
  ```

The format stays 4. Both fields are optional, and Review Deck versions before them ignore fields they don't know: they read the entry as before, and copy it whole when they save another comparison. A format 5 would have made every saved guide unreadable to them, and to the new version until regrouped.

An older Review Deck shows a published guide only if its `mode` matches the reader's, and replaces it like any other guide. So Ajour writes the readers' `mode`, as before.

## How Review Deck treats it

- **Shown** whenever its groups cover exactly the hunks of Review Deck's own diff for that comparison, each once. `mode`, the backend, the AI-title setting and `fellBack` don't matter.
- **Read only if every group is whole:** `id`, `kind`, `title` and `rationale` are strings, and `hunkIds` is an array of strings. Otherwise the entry is incomplete. It isn't shown or kept, and the next grouping replaces it.
- **Grouped again**, as for any guide, when the hunks don't match (a new push, or a different diff cut). That grouping replaces the published guide, which no longer fits.
- **Never replaced on its own.** A reader who regroups gets their own guide, kept in memory for as long as the page is open, with **Publish** in the Files toolbar. Publish saves it in place of the published guide, as Review Deck's own. The reader's guide carries the published summary, so it still shows after a Regroup, and Publish saves it too.
- **Kept first** when a pull request's document drops older comparisons to stay under its limits.
- **The summary is checked line by line.** Its text is trimmed, a line whose text is empty or only spaces is left out, hunk ids not in the diff are dropped, and a ticket link that isn't `http(s)` is dropped. Without a problem to state, no summary shows, but the guide still does. Each line links to the concerns holding its hunks.

## Keeping Ajour in sync

Ajour keeps a vendored copy of `saved.ts` and of `buildDiff`, so that its hunk ids match Review Deck's. The next sync picks up `PublishingApp`, `GuideSummary`, `keepsPublished`, `ownOver` and the `publish` option of `withSaved`.

## Checks

`extension/tests/saved.test.ts` covers the entry, and `extension/tests/own-guide.test.ts` covers the reader's guide and Publish through `buildReview`. `extension/tests/published-guide.browser.js` checks the Files toolbar's label and Publish's toasts in the write harness (`npm run ext:test:browser`, with `npm run ext:dev` running).
