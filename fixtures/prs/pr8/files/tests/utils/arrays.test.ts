import { describe, expect, it } from "vitest";
import { chunk } from "../../src/utils/arrays";

describe("chunk", () => {
  it("splits into slices of the given size, last one shorter", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns an empty array for empty input", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("rejects non-positive sizes", () => {
    expect(() => chunk([1], 0)).toThrow(RangeError);
  });
});
