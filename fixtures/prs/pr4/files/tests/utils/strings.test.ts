import { describe, expect, it } from "vitest";
import { capitalize, isBlank, slugify, truncate } from "../../src/utils/strings";

describe("slugify", () => {
  it("lowercases and dasherizes", () => {
    expect(slugify("  Hello, World!  ")).toBe("hello-world");
  });
});

describe("capitalize", () => {
  it("uppercases the first letter", () => {
    expect(capitalize("alice")).toBe("Alice");
    expect(capitalize("")).toBe("");
  });
});

describe("truncate", () => {
  it("leaves short strings alone", () => {
    expect(truncate("abc", 5)).toBe("abc");
  });

  it("never exceeds max, ellipsis included", () => {
    expect(truncate("abcdefgh", 5)).toBe("abcd…");
    expect(truncate("abcdefgh", 5)).toHaveLength(5);
    expect(truncate("abc", 0)).toBe("");
  });
});

describe("isBlank", () => {
  it("treats whitespace as blank", () => {
    expect(isBlank("   ")).toBe(true);
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank("x")).toBe(false);
  });
});
