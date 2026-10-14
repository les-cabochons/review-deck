import assert from "node:assert/strict";
import { test } from "node:test";
import { slugify } from "../index.js";

test("Given free text, then it becomes a lowercase dash-separated slug", () => {
  assert.equal(slugify("  Review Deck: Stacks & PRs! "), "review-deck-stacks-prs");
});
