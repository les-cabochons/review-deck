import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultTagColor, mergeTags, parseColor, tagNameError, tagPillStyle, tagTextColor, withoutTag, withTag } from "../src/data/tags";

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
