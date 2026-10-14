import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Checks the API key an organization saved with the backend's URL (Project settings → Review Deck), so only
 * the organizations you gave it can call the function.
 */
export function verifyApiKey(presented: string, key: string): boolean {
  // Hashing first makes the comparison constant-time whatever the lengths.
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return key.length > 0 && timingSafeEqual(digest(presented), digest(key));
}
