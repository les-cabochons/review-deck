# Review write actions

Continue the approved full PR review page plan with milestone 2. Run locally against the existing snapshots, with structural grouping and heuristic titles. Keep the native Azure DevOps layout and theme.

## Implementation plan

1. Add typed actions shared by the mock and Azure DevOps sources. Use the signed-in user's identity for votes. Send partial PR updates. For reviewer PUT requests, read and send both the current vote and required flag because Azure DevOps resets omitted fields.
2. Add general comments, replies, thread status, and line comments on both diff sides. Include the file change tracking ID and selected iteration comparison in new line threads.
3. Enable votes, reviewer search and add/remove/required controls, tags, and description edits.
4. Serialize writes, show pending and failure states, preserve failed drafts, and reload server data after successful writes. Preserve the selected comparison and avoid recomputing diffs after comment or vote changes.
5. Add focused adapter and mock regression tests, exercise real browser flows, and run both typechecks and the extension build.

## Backlog

- [x] Milestone 1: read path, semantic and alphabetical views, inline and split diffs, activity and commits.
- [x] Milestone 2: typed write actions and local mock behavior.
- [x] Milestone 2: interactive review controls and line comments.
- [x] Milestone 2: regression tests and browser verification.
- [x] Publish and install privately in Azure DevOps Services, then validate milestone 2 writes on test PR #1.
- [ ] [Finish live validation cases requiring more test data or permissions](https://github.com/alextrepa/semantic-pr/issues/1). Cross-update/rename anchors, group identities, another reviewer's vote, and actual permission denials remain unverified.
- [x] Milestone 3: completion, auto-complete, abandon, merge options.
- [ ] Reviewed-file state.
- [ ] Later: work item linking, comment editing/deletion, likes, identity mentions, syntax highlighting, expanded context.
- [ ] Deferred: stack navigation, browser embeddings and LLM titles.

The extension was privately published and installed for the approved test organization. Live smoke tests changed PR #1 and restored its original metadata. This work remains uncommitted locally. No push or new PR creation occurred.

## Live validation target

- Publisher ID: `Cabochonio`.
- Organization: [cabochons](https://dev.azure.com/cabochons).
- Project and repository: `Semantic_pr`.
- Test PR: [Semantic_pr #1](https://dev.azure.com/cabochons/Semantic_pr/_git/Semantic_pr/pullrequest/1).
- User approved private publication, sharing and installation in `cabochons`, and write tests on PR #1.

Version `0.1.2` is installed and loaded from the Marketplace. The native PR menu opens the parameterized review hub. Its Overview, Files, and Commits tabs load the one-update README change. The Files tab supports grouped/alphabetical and inline/side-by-side views.

## Live validation results

- Posted a general discussion and two line threads, with a reply on the right-side thread. Resolved and reopened that thread, then resolved all three. Native PR data confirmed the reply and the left line 20 and right line 21 anchors, with change tracking ID 1 and comparison iteration IDs 1/1.
- Searched for the signed-in user and added/removed that reviewer. Tested optional/required changes while preserving vote 5. Cast votes 10, 5, -5, -10, and 0 while preserving the required flag.
- Added/removed the `semantic-pr-smoke` tag and edited/restored the description. Native PR data confirmed the results.
- Injected an HTTP 403 for a comment POST in the installed page. The page retained the draft and showed the server error. The rejected draft was never posted. This tests error handling, not actual organization ACLs.
- Verified the reviewer search avatar loads from `dev.azure.com/cabochons` in the installed version.
- Final server checks confirmed the PR remains active, description is exactly `Updated README.md`, reviewers and tags are empty as before, and all three smoke-test threads are resolved. Audit events and resolved test discussions remain as evidence. User-added replies were preserved.

The original reviewer PUT implementation reset votes when changing requirements and reset requirements when voting. Version `0.1.2` reads the latest reviewer values and sends both fields. A failing live assertion and two failing regression tests reproduced the problem before the fix. The installed version now passes both preservation checks.

Test PR #1 has one iteration and a README whitespace edit. It cannot validate comments across updates or renames. Group identities, another user's vote, and genuine denied permissions still need a suitable test case. PR completion and abandonment were not exercised.

## Local validation

- All 18 adapter and mock regression tests pass. They cover selected-side anchors, common-commit and update-to-update comparisons, stale comparisons, missing tracking data, replies, status changes, own-user votes, reviewer vote/requirement preservation, aborting writes after failed reviewer reads, metadata edits, renamed-file tracking IDs, and relative/absolute avatar URLs.
- Browser checks exercised general comments, replies, resolving a thread, voting, reviewer search/add/required changes, tags, description edits, and line comments in grouped and alphabetical views with inline and split diffs.
- The isolated browser harness confirmed draft retention after rejected writes, refresh recovery without duplicate posts, duplicate-submission prevention during a delayed write, and no additional diff analysis after these operations.
- Existing comment positions across updates use the Azure DevOps tracking API. The mock only shows newly anchored threads in their original comparison. Older imported comments have no iteration metadata.
- Both typechecks, the production build, and VSIX packaging pass. Archive inspection confirms that the three WASM assets are present and the test harness and mock snapshots are excluded.
- Write validation used the private `Cabochonio.semantic-pr-review-0.1.2.vsix` package. Version `0.1.5` is now installed with startup fixes and eight additional regression tests. See [startup-loading.md](startup-loading.md) for browser checks and live results.
