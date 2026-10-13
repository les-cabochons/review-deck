import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildChangelog,
  type Commit,
  conventionTags,
  descriptionDocumentId,
  digestFor,
  formatBytes,
  isRelease,
  matchesConvention,
  parseChecksums,
  parseCommit,
  previousTag,
  readReleaseSettings,
  repoReleaseSettings,
} from "../src/data/releases";

const tags = (...names: string[]) => names.map((name) => ({ name }));
const commit = (message: string, extra: Partial<Commit> = {}): Commit => ({ id: message.slice(0, 7), message, author: "Ada", date: null, ...extra });

test("Given a tag convention, then only matching git tags are listed, newest version first", () => {
  assert.equal(matchesConvention("v1.2.0", "v*"), true);
  assert.equal(matchesConvention("release/1.2.0", "v*"), false);
  assert.equal(matchesConvention("release/1.2.0", "release/*"), true);
  const sorted = conventionTags(tags("v1.10.0", "v1.2.0", "v1.10.0-rc.1", "v1.10.0-rc.10", "v1.10.0-beta", "build-42", "vNext"), "v*");
  assert.deepEqual(
    sorted.map((t) => t.name),
    ["v1.10.0", "v1.10.0-rc.10", "v1.10.0-rc.1", "v1.10.0-beta", "v1.2.0", "vNext"],
  );
});

test("Given a stable version, then its previous tag is the previous stable version; a prerelease starts from the tag before it", () => {
  const sorted = conventionTags(tags("v1.3.0", "v1.3.0-rc.2", "v1.3.0-rc.1", "v1.2.0", "v1.1.0"), "v*");
  const named = (n: string) => sorted.find((t) => t.name === n)!;
  assert.equal(previousTag(sorted, named("v1.3.0"))?.name, "v1.2.0");
  assert.equal(previousTag(sorted, named("v1.3.0-rc.2"))?.name, "v1.3.0-rc.1");
  assert.equal(previousTag(sorted, named("v1.3.0-rc.1"))?.name, "v1.2.0");
  assert.equal(previousTag(sorted, named("v1.1.0")), null);
});

test("Given conventional commits, then type, scope, breaking change and Azure DevOps' PR prefix are read", () => {
  assert.deepEqual(parseCommit(commit("Merged PR 42: feat(ui)!: new stacks panel")), {
    sha: "Merged ",
    type: "feat",
    scope: "ui",
    subject: "new stacks panel",
    breaking: true,
    author: "Ada",
    pullRequest: 42,
  });
  const footer = parseCommit(commit("fix: drop the old API\n\nBREAKING CHANGE: the v1 route is gone"));
  assert.equal(footer.breaking, true);
  const plain = parseCommit(commit("Update README"));
  assert.equal(plain.type, null);
  assert.equal(plain.subject, "Update README");
  assert.equal(parseCommit(commit("Remove the v1 API\n\nBREAKING CHANGE: clients must use v2")).breaking, true);
});

test("Given commits since the previous tag, then the Changelog groups them in section order and skips merges", () => {
  const sections = buildChangelog([
    commit("chore: bump deps"),
    commit("Merge branch 'main'", { parents: 2 }),
    commit("feat: tags view"),
    commit("Tweak spacing"),
    commit("fix(api): retry on 429"),
    commit("feat!: drop Node 18"),
    commit("ci: cache npm"),
  ]);
  assert.deepEqual(
    sections.map((s) => [s.title, s.entries.map((e) => e.subject)]),
    [
      ["⚠️ Breaking changes", ["drop Node 18"]],
      ["Features", ["tags view"]],
      ["Bug fixes", ["retry on 429"]],
      ["Build & CI", ["cache npm"]],
      ["Chores", ["bump deps"]],
      ["Other changes", ["Tweak spacing"]],
    ],
  );
});

test("Given a latest run, then the tag is a Release only if it succeeded, fully or partially, and produced Artifacts", () => {
  const run = { id: 1, pipeline: "publish", number: "20261013.1", result: "succeeded" as const, finished: null, url: "" };
  assert.equal(isRelease(run, 2), true);
  assert.equal(isRelease({ ...run, result: "partiallySucceeded" }, 1), true);
  assert.equal(isRelease(run, 0), false);
  assert.equal(isRelease({ ...run, result: "failed" }, 3), false);
  assert.equal(isRelease(null, 0), false);
});

test("Given SHA256SUMS or a .sha256 sidecar, then each file gets its digest", () => {
  const hex = "a".repeat(64);
  const other = "B".repeat(64);
  const sums = parseChecksums("drop/SHA256SUMS", `${hex}  t3-win32-x64.zip\n${other} *dist/t3-linux.tar.gz\n\nnot a line`);
  assert.equal(digestFor([sums], "drop/t3-win32-x64.zip"), hex);
  assert.equal(digestFor([sums], "t3-linux.tar.gz"), "b".repeat(64));
  assert.equal(digestFor([sums], "missing.zip"), null);
  assert.equal(parseChecksums("t3.dmg.sha256", `${hex}\n`).get("t3.dmg"), hex);
  // A file's own artifact wins over another artifact's same-named file.
  const own = parseChecksums("linux/SHA256SUMS", `${other}  t3-win32-x64.zip`);
  assert.equal(digestFor([own, sums], "t3-win32-x64.zip"), "b".repeat(64));
});

test("Given saved settings, then the repo's tag convention and publishing pipeline fall back to the project's", () => {
  const settings = readReleaseSettings({ tagConvention: " release/* ", repos: { a: { pipelineId: 7 }, b: { tagConvention: "v*" }, c: { pipelineId: "x" } } });
  assert.deepEqual(repoReleaseSettings(settings, "a"), { tagConvention: "release/*", pipelineId: 7 });
  assert.deepEqual(repoReleaseSettings(settings, "b"), { tagConvention: "v*", pipelineId: null });
  assert.deepEqual(Object.keys(settings.repos), ["a", "b"]);
  assert.deepEqual(readReleaseSettings(undefined), { tagConvention: "v*", repos: {} });
});

test("Given tag names, then description document ids fit Azure DevOps' 50 characters and don't collide", () => {
  assert.equal(descriptionDocumentId("v1.2.3"), "v1.2.3");
  const a = descriptionDocumentId("release/1.2.3");
  const b = descriptionDocumentId("release_1.2.3");
  assert.notEqual(a, b);
  assert.ok(descriptionDocumentId(`release/${"x".repeat(80)}`).length <= 50);
});

test("Given byte counts, then sizes read like GitHub's assets", () => {
  assert.equal(formatBytes(576), "576 B");
  assert.equal(formatBytes(80.7 * 1024 * 1024), "80.7 MB");
  assert.equal(formatBytes(153 * 1024 * 1024), "153 MB");
});
