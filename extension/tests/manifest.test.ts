import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

interface Contribution {
  id: string;
  properties?: { supportsMobile?: boolean; icon?: unknown };
}

const manifest = JSON.parse(readFileSync("extension/vss-extension.json", "utf8")) as { contributions: Contribution[] };

// Azure DevOps sets the page's viewport to `width=device-width` only when the shown hub has supportsMobile. Without it,
// it empties the viewport tag and a phone lays the page out 980 px wide, zoomed out, so the phone layouts never apply.
test("the Deck and Changelog hubs declare supportsMobile", () => {
  for (const id of ["review-hub", "changelog-hub"]) {
    const hub = manifest.contributions.find((c) => c.id === id);
    assert.equal(hub?.properties?.supportsMobile, true, id);
  }
});

// The marketplace logo (a 128 px black tile) looked like a stray picture among the menu's monochrome icons: the menu
// item has the Deck hub's glyphs, one per theme.
test("Open in Review Deck has the Deck hub's icon, for each theme", () => {
  const icon = (id: string) => manifest.contributions.find((c) => c.id === id)?.properties?.icon;
  assert.deepEqual(icon("open-review-action"), icon("review-hub"));
  assert.deepEqual(icon("open-review-action"), { light: "images/deck-light.png", dark: "images/deck-dark.png" });
});
