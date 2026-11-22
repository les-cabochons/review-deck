import assert from "node:assert/strict";
import { test } from "node:test";
import type { IExtensionDataManager } from "azure-devops-extension-api/Common";
import {
  defaultTagColor,
  mergeTags,
  parseColor,
  sidebarTags,
  tagNameError,
  type TagStyles,
  tagPillStyle,
  tagTextColor,
  withoutTag,
  withTag,
  withTagHidden,
} from "../src/data/tags";
import { AdoTagStore } from "../src/app/adoTags";

test("Given tag names from Azure DevOps, PRs and saved styles, then each tag appears once with its style", () => {
  const tags = mergeTags(["bug", "Docs", "BUG"], { bug: { color: "#B60205", description: "Broken" }, "needs-design": { name: "Needs design", color: "#5319e7" } });
  assert.deepEqual(
    tags.map((t) => [t.name, t.color, t.description]),
    [
      ["bug", "#b60205", "Broken"],
      ["Docs", defaultTagColor("docs"), ""],
      ["Needs design", "#5319e7", ""],
    ],
  );
});

test("Given a renamed tag, then its style moves to the new name", () => {
  const styles = withTag({ bug: { color: "#b60205" } }, "bug", { name: "Defect", color: "#abc", description: " Broken " });
  assert.deepEqual(styles, { defect: { name: "Defect", color: "#aabbcc", description: "Broken" } });
  assert.deepEqual(withoutTag(styles, "DEFECT"), {});
});

test("Given tag input, then names and colors are validated", () => {
  assert.equal(parseColor("1D76DB"), "#1d76db");
  assert.equal(parseColor("#12"), null);
  assert.equal(tagTextColor("#fef2c0"), "#1f2328");
  assert.equal(tagTextColor("#0052cc"), "#ffffff");
  const tags = mergeTags(["bug", "docs"], {});
  assert.equal(tagNameError("Bug", tags, null), "A tag with this name already exists.");
  assert.equal(tagNameError("Bug", tags, "bug"), null);
  assert.equal(tagNameError("a,b", tags, null), "Names can't contain commas or semicolons.");
  assert.equal(tagNameError("  ", tags, null), "Enter a name.");
});

test("Given a dark theme, then pills are a tint of the color with text lightened only for dark colors", () => {
  assert.deepEqual(tagPillStyle("#0052cc", false), { background: "#0052cc", color: "#ffffff", borderColor: "rgba(0, 0, 0, 0.12)" });
  const blue = tagPillStyle("#0052cc", true);
  assert.equal(blue.background, "rgba(0, 82, 204, 0.18)");
  assert.equal(blue.color, `hsl(216, 100%, ${40 + (0.6 - (82 * 0.7152 + 204 * 0.0722) / 255) * 100}%)`);
  // Already light: kept as is.
  assert.equal(tagPillStyle("#fef2c0", true).color, "hsl(48, 97%, 87%)");
});

test("Given hidden tags, then the sidebar lists the others, plus the hidden one filtering the list", () => {
  const styles = withTagHidden(withTagHidden({}, "2.2.0", true), "Prod", true);
  const tags = mergeTags(["2.2.0", "bug", "PROD"], styles);
  assert.deepEqual(
    sidebarTags(tags, null).map((t) => t.name),
    ["bug"],
  );
  // Hiding the tag that filters the list keeps it listed, so the filter can still be cleared.
  assert.deepEqual(
    sidebarTags(tags, "prod").map((t) => t.name),
    ["bug", "PROD"],
  );
  assert.deepEqual(
    sidebarTags(mergeTags(["2.2.0", "bug", "PROD"], withTagHidden(styles, "PROD", false)), null).map((t) => t.name),
    ["bug", "PROD"],
  );
});

test("Given a tag hidden, then it keeps its color and stays hidden through an edit and a rename", () => {
  // Never styled: hiding stores the color it already shows.
  const hidden = withTagHidden({}, "PROD", true);
  assert.deepEqual(hidden, { prod: { name: "PROD", color: defaultTagColor("prod"), hidden: true } });
  const styled = withTagHidden({ bug: { color: "#b60205", description: "Broken" } }, "bug", true);
  assert.deepEqual(styled, { bug: { color: "#b60205", description: "Broken", hidden: true } });
  // The tag form never sends the flag; saving keeps it.
  const edited = withTag(styled, "bug", { name: "bug", color: "#0e8a16", description: "Broken" });
  assert.equal(edited.bug.hidden, true);
  const renamed = withTag(edited, "bug", { name: "Defect", color: "#0e8a16", description: "Broken" });
  assert.deepEqual(Object.keys(renamed), ["defect"]);
  assert.equal(renamed.defect.hidden, true);
  // Shown again: the flag is gone, not stored as false.
  assert.deepEqual(withTagHidden(renamed, "defect", false), { defect: { name: "Defect", color: "#0e8a16", description: "Broken" } });
});

/** An Azure DevOps tag store over extension data with slow reads and writes, like the real service. */
function slowAdoTagStore() {
  const state: { doc: { tags: TagStyles } | null } = { doc: null };
  const later = <T>(value: () => T) => new Promise<T>((resolve) => setTimeout(() => resolve(value()), 5));
  const data = {
    getDocument: () => later(() => (state.doc ? structuredClone(state.doc) : Promise.reject(Object.assign(new Error("Not found"), { status: 404 })))),
    setDocument: (_: string, next: { tags: TagStyles }) => later(() => (state.doc = structuredClone({ tags: next.tags }))),
  } as unknown as IExtensionDataManager;
  const store = new AdoTagStore({ hostUrl: "https://dev.azure.com/org/", projectId: "project", token: async () => "", data: async () => data });
  return { store, state };
}

test("Given two tags hidden at once in Azure DevOps, then the saved styles keep both", async () => {
  // Two saves that each read before the other writes would keep only the last tag.
  const { store, state } = slowAdoTagStore();
  await Promise.all([store.hide("2.2.0", true), store.hide("2.3.0", true)]);
  assert.deepEqual(Object.keys(state.doc!.tags).sort(), ["2.2.0", "2.3.0"]);
  assert.ok(Object.values(state.doc!.tags).every((style) => style.hidden));
});

test("Given a Hide still saving in Azure DevOps, then listing the tags shows it hidden", async (t) => {
  // The project's tag definitions: none, so the list is the styled tags.
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ value: [] })));
  const { store } = slowAdoTagStore();
  const saving = store.hide("2.2.0", true);
  const tags = await store.list();
  await saving;
  assert.deepEqual(tags.map((tag) => [tag.name, tag.hidden]), [["2.2.0", true]]);
});
