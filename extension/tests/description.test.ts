import assert from "node:assert/strict";
import { test } from "node:test";
import type { HunkInfo } from "../../src/core/types";
import { parseDescriptionSteps, stepAffinities } from "../../src/score/description";

const guided = [
  "**Problem.** Bitbucket pull requests came back without a head commit.",
  "",
  "**Fix, in reading order:**",
  "1. **Decode the source commit** (`packages/bitbucket/src/server/pullRequestJson.ts`). Adds `headSha`.",
  "   - Nested detail stays in step 1.",
  "2. **Pass it on** (`packages/source-control-{core,bitbucket}/src/client/definition.ts`). `toChangeRequest` adds it.",
  "3. **Docs** under `docs/user/`.",
].join("\n");

/** Just what step matching reads. */
function hunk(id: string, path: string, facts: { defines?: string[]; references?: string[] } = {}): HunkInfo {
  return {
    hunk: { id, path, index: 0, header: "", oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [] },
    file: { path, oldPath: path, newPath: path, status: "modified", similarity: null, binary: false, headerLines: [], hunks: [] },
    language: "typescript",
    isTest: /\.test\./.test(path),
    symbol: null,
    enclosing: [],
    defines: new Set(facts.defines),
    impacts: new Set(),
    references: new Set(facts.references),
    tokens: new Set(),
    fileImports: new Set(),
    commentOnly: false,
    addedDecls: [],
    removedDecls: [],
    mechanical: null,
    text: "",
  };
}

const noEmbeddings = { hunkEmbeddings: null, stepEmbeddings: null, semanticFloor: 0.5 };

test("Given a description with a numbered list, then each top-level item is a step with its files and symbols", () => {
  const steps = parseDescriptionSteps(guided);
  assert.deepEqual(
    steps.map((s) => s.label),
    ["Problem.", "Fix, in reading order:", "Decode the source commit", "Pass it on", "Docs"],
  );
  assert.match(steps[2].text, /Nested detail/);
  assert.deepEqual(steps[2].paths, ["packages/bitbucket/src/server/pullRequestJson.ts"]);
  assert.ok(steps[2].symbols.has("headSha"));
  assert.deepEqual(steps[3].paths, ["packages/source-control-core/src/client/definition.ts", "packages/source-control-bitbucket/src/client/definition.ts"]);
  assert.ok(steps[3].symbols.has("toChangeRequest"));
  assert.deepEqual(steps[4].paths, ["docs/user/"]);
});

test("Given hunks named by a step's files, folders or symbols, then they belong to that step", () => {
  const steps = parseDescriptionSteps(guided);
  const hunks = [
    hunk("json#0", "packages/bitbucket/src/server/pullRequestJson.ts"),
    hunk("json.test#0", "packages/bitbucket/src/server/pullRequestJson.test.ts"),
    hunk("core#0", "packages/source-control-core/src/client/definition.ts"),
    hunk("provider#0", "packages/bitbucket/src/server/Provider.ts", { defines: ["toChangeRequest"] }),
    hunk("docs#0", "docs/user/prompt-links.md"),
    hunk("other#0", "apps/web/src/unrelated.ts"),
  ];
  const affinity = stepAffinities(hunks, steps, noEmbeddings);
  const stepsOf = (id: string) => [...(affinity.get(id)?.keys() ?? [])];
  assert.deepEqual(stepsOf("json#0"), [3]);
  // A test of a named file goes with it.
  assert.deepEqual(stepsOf("json.test#0"), [3]);
  assert.deepEqual(stepsOf("core#0"), [4]);
  assert.deepEqual(stepsOf("provider#0"), [4]);
  assert.deepEqual(stepsOf("docs#0"), [5]);
  assert.equal(affinity.has("other#0"), false);
  assert.ok(affinity.get("json#0")!.get(3)! > affinity.get("provider#0")!.get(4)!, "a named file is stronger evidence than a named symbol");
});

test("Given a description without steps, then it doesn't guide grouping", () => {
  const steps = parseDescriptionSteps("Test PR for Semantic PR Review: upstream commit `5fe7568e87`, cherry-picked onto `main`.");
  assert.equal(steps.length, 1);
  assert.equal(stepAffinities([hunk("a#0", "src/main.ts")], steps, noEmbeddings).size, 0);
});

test("Given a group that mostly matches one step, then it takes the step's heading and first sentences", async () => {
  const { titlesFromDescription } = await import("../../src/title/fromDescription");
  const group = (id: string, ...hunks: HunkInfo[]) => ({ group: { id, kind: "semantic" as const, hunkIds: hunks.map((h) => h.hunk.id), title: "", rationale: "" }, hunks, pairs: [] });
  const titles = titlesFromDescription(
    [
      group("g1", hunk("json#0", "packages/bitbucket/src/server/pullRequestJson.ts"), hunk("json.test#0", "packages/bitbucket/src/server/pullRequestJson.test.ts")),
      group("g2", hunk("core#0", "packages/source-control-core/src/client/definition.ts")),
      group("g3", hunk("other#0", "apps/web/src/unrelated.ts")),
    ],
    guided,
  );
  assert.deepEqual(titles[0], { title: "Decode the source commit", rationale: "Adds headSha. Nested detail stays in step 1.", source: "description" });
  assert.deepEqual(titles[1], { title: "Pass it on", rationale: "toChangeRequest adds it.", source: "description" });
  // No step names it, and lead-ins ("**Problem.** ...") never title a group.
  assert.equal(titles[2], null);
});
