import assert from "node:assert/strict";
import { test } from "node:test";
import type { FileDiff } from "../../src/core/types";
import type { FileChange } from "../src/data/model";
import { fullyViewedFiles, parseViewed, setHunksViewed, viewedHunkIds, viewedStatus } from "../src/ui/viewed";

const changes: FileChange[] = [
  { path: "src/shared.ts", changeType: "edit", oldObjectId: "base", newObjectId: "head" },
  { path: "src/other.ts", changeType: "add", newObjectId: "other" },
  { path: "src/gone.ts", changeType: "delete", oldObjectId: "gone" },
  { path: "src/new.ts", originalPath: "src/old.ts", changeType: "rename", oldObjectId: "same", newObjectId: "same" },
];

/** A file with `chunks` hunks, ids `<path>#<n>` like the diff parser's. */
function file(path: string, chunks = 1): FileDiff {
  const hunks = Array.from({ length: chunks }, (_, index) => ({
    id: `${path}#${index}`, path, index, header: "", oldStart: 0, oldLines: 0, newStart: 0, newLines: 0, lines: [],
  }));
  return { path, oldPath: path, newPath: path, status: "modified", similarity: null, binary: false, headerLines: [], hunks };
}

// src/shared.ts has a chunk in two concerns.
const files = [file("src/shared.ts", 2), file("src/other.ts"), file("src/gone.ts"), file("src/new.ts")];
const allChunks = files.flatMap(f => f.hunks.map(h => h.id));

test("Given a file with chunks in two concerns, when one chunk is marked viewed, then its other chunk and the file stay unviewed", () => {
  const viewed = viewedHunkIds(setHunksViewed({}, files, changes, ["src/shared.ts#0"], true), files, changes);
  assert.deepEqual([...viewed], ["src/shared.ts#0"]);
  assert.deepEqual(viewedStatus(["src/shared.ts#1"], viewed), { checked: false, mixed: false });
  assert.deepEqual(viewedStatus(["src/shared.ts#0", "src/shared.ts#1"], viewed), { checked: false, mixed: true });
  assert.equal(fullyViewedFiles(files, viewed).has("src/shared.ts"), false);
  assert.deepEqual(viewedStatus([], viewed), { checked: false, mixed: false });
});

test("Given every chunk of a file marked viewed across concerns, then the file counts as viewed", () => {
  let saved = setHunksViewed({}, files, changes, ["src/shared.ts#0", "src/other.ts#0"], true);
  saved = setHunksViewed(saved, files, changes, ["src/shared.ts#1"], true);
  assert.deepEqual([...fullyViewedFiles(files, viewedHunkIds(saved, files, changes))], ["src/shared.ts", "src/other.ts"]);
});

test("Given a mixed concern, when it is checked then unchecked, then its chunks update together and unrelated viewed chunks remain", () => {
  const concern = ["src/shared.ts#1", "src/other.ts#0"];
  let saved = setHunksViewed({}, files, changes, ["src/gone.ts#0", "src/shared.ts#1"], true);
  saved = setHunksViewed(saved, files, changes, concern, true);
  assert.deepEqual(viewedStatus(concern, viewedHunkIds(saved, files, changes)), { checked: true, mixed: false });
  saved = setHunksViewed(saved, files, changes, concern, false);
  assert.deepEqual([...viewedHunkIds(saved, files, changes)], ["src/gone.ts#0"]);
});

test("Given viewed chunks saved locally, when either compared blob changes or a file leaves the comparison, then its viewed checks reset", () => {
  const saved = setHunksViewed({}, files, changes, allChunks, true);
  assert.equal(viewedHunkIds(parseViewed(JSON.stringify(saved)), files, changes).size, 5);
  assert.equal(viewedHunkIds(saved, files, changes.map(change => ({ ...change, newObjectId: "force-pushed" }))).size, 0);
  assert.equal(viewedHunkIds(saved, files, changes.map(change => ({ ...change, oldObjectId: "new-base" }))).size, 0);
  assert.equal(viewedHunkIds(saved, files, []).size, 0);
  assert.equal(viewedHunkIds(saved, files, changes.map(change => ({ ...change, originalPath: "different.ts" }))).size, 0);
});

test("Given malformed local storage, then loading viewed chunks falls back to an empty state or keeps only valid versions", () => {
  for (const raw of [null, "not json", "null", "[]", "42", '"text"']) assert.deepEqual(parseViewed(raw), {});
  assert.deepEqual(parseViewed('{"src/a#0":1,"src/b#0":"version"}'), { "src/b#0": "version" });
});
