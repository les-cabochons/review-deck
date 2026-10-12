import { describe, expect, it } from "vitest";
import { buildQueryString } from "../../src/utils/query";

describe("buildQueryString", () => {
  it("returns an empty string for no params", () => {
    expect(buildQueryString(undefined)).toBe("");
    expect(buildQueryString({})).toBe("");
  });

  it("skips undefined values and encodes the rest", () => {
    expect(buildQueryString({ q: "a b", page: 2, role: undefined })).toBe("?q=a%20b&page=2");
  });
});
