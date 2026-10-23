import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

interface Contribution {
  id: string;
  properties?: { supportsMobile?: boolean };
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
