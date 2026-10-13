import assert from "node:assert/strict";
import { test } from "node:test";
import type { FileChange } from "../src/data/model";
import { parseViewed, setFilesViewed, viewedPaths, viewedStatus } from "../src/ui/viewed";

const changes: FileChange[] = [
  { path: "src/shared.ts", changeType: "edit", oldObjectId: "base", newObjectId: "head" },
  { path: "src/other.ts", changeType: "add", newObjectId: "other" },
  { path: "src/gone.ts", changeType: "delete", oldObjectId: "gone" },
  { path: "src/new.ts", originalPath: "src/old.ts", changeType: "rename", oldObjectId: "same", newObjectId: "same" },
];

test("Given a file shared by concerns, when one concern marks it viewed, then both concerns see one file and mixed progress", () => {
  const saved = setFilesViewed({}, changes, ["src/shared.ts", "src/shared.ts"], true);
  const viewed = viewedPaths(saved, changes);
  assert.equal(viewed.size, 1);
  assert.deepEqual(viewedStatus(["src/shared.ts"], viewed), { checked: true, mixed: false });
  assert.deepEqual(viewedStatus(["src/shared.ts", "src/other.ts"], viewed), { checked: false, mixed: true });
  assert.deepEqual(viewedStatus([], viewed), { checked: false, mixed: false });
});

test("Given a mixed concern, when it is checked then unchecked, then its files update together and unrelated viewed files remain", () => {
  let saved = setFilesViewed({}, changes, ["src/gone.ts"], true);
  saved = setFilesViewed(saved, changes, ["src/shared.ts", "src/other.ts"], true);
  assert.deepEqual(viewedStatus(["src/shared.ts", "src/other.ts"], viewedPaths(saved, changes)), { checked: true, mixed: false });
  saved = setFilesViewed(saved, changes, ["src/shared.ts", "src/other.ts"], false);
  assert.deepEqual([...viewedPaths(saved, changes)], ["src/gone.ts"]);
});

test("Given viewed files saved locally, when either compared blob changes or a file leaves the comparison, then its viewed check resets", () => {
  const saved = setFilesViewed({}, changes, changes.map(change => change.path), true);
  assert.equal(viewedPaths(parseViewed(JSON.stringify(saved)), changes).size, 4);
  assert.equal(viewedPaths(saved, changes.map(change => ({ ...change, newObjectId: "force-pushed" }))).size, 0);
  assert.equal(viewedPaths(saved, changes.map(change => ({ ...change, oldObjectId: "new-base" }))).size, 0);
  assert.equal(viewedPaths(saved, []).size, 0);
  assert.equal(viewedPaths(saved, changes.map(change => ({ ...change, originalPath: "different.ts" }))).size, 0);
});

test("Given malformed local storage, then loading viewed files falls back to an empty state or keeps only valid versions", () => {
  for (const raw of [null, "not json", "null", "[]", "42", '"text"']) assert.deepEqual(parseViewed(raw), {});
  assert.deepEqual(parseViewed('{"src/a":1,"src/b":"version"}'), { "src/b": "version" });
});
