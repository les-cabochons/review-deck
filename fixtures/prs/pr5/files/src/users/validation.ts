import type { UserRecord, UserRole } from "./types";

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const ROLES: readonly UserRole[] = ["admin", "member", "guest"];

export type UserInput = Omit<UserRecord, "id" | "createdAt">;

export function validateUser(input: Partial<UserInput>): string[] {
  const errors: string[] = [];
  if (!input.email || !isValidEmail(input.email)) {
    errors.push("email is invalid");
  }
  if (!input.displayName || input.displayName.trim().length < 2) {
    errors.push("displayName must be at least 2 characters");
  }
  if (!input.role || !ROLES.includes(input.role)) {
    errors.push(`role must be one of ${ROLES.join(", ")}`);
  }
  return errors;
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

/** Validates only the fields present in a partial update. */
export function validateUserPatch(patch: Partial<UserInput>): string[] {
  if (Object.keys(patch).length === 0) return ["update is empty"];
  const placeholder: UserInput = { email: "placeholder@example.com", displayName: "placeholder", role: "guest" };
  return validateUser({ ...placeholder, ...patch });
}
