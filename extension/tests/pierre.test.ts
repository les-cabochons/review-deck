import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDiff } from "../../src/diff/parse";
import { lineAnnotations, pierreHunk, pierreSide, reviewSide } from "../src/ui/pierre/adapter";
import { highlightLanguage } from "../src/ui/pierre/languages";

const patch = `diff --git a/src/user.ts b/src/user.ts
--- a/src/user.ts
+++ b/src/user.ts
@@ -40,3 +80,4 @@ function loadUser
 const before = true;
-const user = oldUser;
+const user = newUser;
+return user;
 const after = true;
`;

test("Given a semantic hunk away from line one, then Pierre preserves both original line coordinates", () => {
  const file = parseDiff(patch)[0];
  const parsed = pierreHunk(file, file.hunks[0]);
  assert.equal(parsed.hunks[0].deletionStart, 40);
  assert.equal(parsed.hunks[0].additionStart, 80);
  assert.equal(parsed.lang, "typescript");
  assert.equal(parsed.isPartial, true);
});

test("Given comments on changed and context lines, then annotations stay on their exact sides and hide out-of-hunk comments", () => {
  const hunk = parseDiff(patch)[0].hunks[0];
  assert.deepEqual(lineAnnotations(hunk, ["left:40", "right:80", "left:41", "right:82", "left:82", "right:100", "right:82"]), [
    { side: "deletions", lineNumber: 40, metadata: "left:40" },
    { side: "additions", lineNumber: 80, metadata: "right:80" },
    { side: "deletions", lineNumber: 41, metadata: "left:41" },
    { side: "additions", lineNumber: 82, metadata: "right:82" },
  ]);
  assert.equal(reviewSide(pierreSide("left")), "left");
  assert.equal(reviewSide(pierreSide("right")), "right");
});

test("Given a rename or deletion, then Pierre preserves file identity and deletion coordinates", () => {
  const renamed = parseDiff(patch.replace("diff --git a/src/user.ts b/src/user.ts", "diff --git a/src/old.ts b/src/user.ts\nsimilarity index 80%\nrename from src/old.ts\nrename to src/user.ts").replace("--- a/src/user.ts", "--- a/src/old.ts"))[0];
  const metadata = pierreHunk(renamed, renamed.hunks[0]);
  assert.equal(metadata.name, "src/user.ts");
  assert.equal(metadata.prevName, "src/old.ts");
  const deleted = parseDiff("diff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\n--- a/gone.ts\n+++ /dev/null\n@@ -12,1 +0,0 @@\n-const gone = true;\n")[0];
  assert.equal(pierreHunk(deleted, deleted.hunks[0]).type, "deleted");
  assert.deepEqual(lineAnnotations(deleted.hunks[0], ["left:12", "right:0"]), [{ side: "deletions", lineNumber: 12, metadata: "left:12" }]);
});

test("Given two comparisons with the same hunk ID, then Pierre receives fresh content instead of a shared cache key", () => {
  const a = parseDiff(patch)[0];
  const b = parseDiff(patch.replace("newUser", "anotherUser"))[0];
  const first = pierreHunk(a, a.hunks[0]);
  const second = pierreHunk(b, b.hunks[0]);
  assert.notDeepEqual(first.additionLines, second.additionLines);
  assert.equal(first.cacheKey, undefined);
  assert.equal(second.cacheKey, undefined);
});

test("Given an unbundled language, then highlighting falls back to text without a remote grammar request", () => {
  assert.equal(highlightLanguage("README.md"), "markdown");
  assert.equal(highlightLanguage("view.tsx"), "tsx");
  assert.equal(highlightLanguage("code.unknown"), "text");
});
