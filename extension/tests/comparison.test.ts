import assert from "node:assert/strict";
import { test } from "node:test";
import { type Comparison, followLatest } from "../src/ui/comparison";

const update = (iteration: number, compareTo = 0): Comparison => ({ iteration, compareTo });
const unknown = update(0);

test("Given a first load that failed after its partial, when a push lands before the retry, then the Files tab moves to the new update", () => {
  // The partial picks update 3, then a later read fails.
  let picked = unknown;
  let shown = followLatest(unknown, picked, update(3));
  picked = update(3);
  assert.deepEqual(shown, update(3));
  // The retry's partial and full load both see update 4.
  shown = followLatest(shown, picked, update(4));
  picked = update(4);
  shown = followLatest(shown, picked, update(4));
  assert.deepEqual(shown, update(4));
});

test("Given a comparison the reader chose, then a later load leaves it", () => {
  assert.deepEqual(followLatest(update(2, 1), update(3), update(4)), update(2, 1));
  assert.deepEqual(followLatest(update(2), update(3), update(4)), update(2));
});

test("Given the kept copy on update 3, when the load finds update 4, then the Files tab moves to it", () => {
  assert.deepEqual(followLatest(update(3), update(3), update(4)), update(4));
});
