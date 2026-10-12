import { describe, expect, it } from "vitest";
import { isValidEmail } from "../../src/users/validation";

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidEmail("alice@example.com")).toBe(true);
    expect(isValidEmail("a.b@mail.example.co.uk")).toBe(true);
  });

  it("rejects empty, consecutive or trailing dots in the domain", () => {
    expect(isValidEmail("a@example..com")).toBe(false);
    expect(isValidEmail("a@example.com.")).toBe(false);
    expect(isValidEmail("a@.example.com")).toBe(false);
  });
});
