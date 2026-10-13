import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Checks an Azure DevOps extension app token (SDK.getAppToken() on the page): an HS256 JWT signed
 * with the extension's certificate secret, so only users of an organization where the extension is
 * installed can call the function.
 */
export function verifyAppToken(token: string, secret: string, now = Date.now() / 1000): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [header, payload, signature] = parts;
  try {
    if (JSON.parse(decode(header)).alg !== "HS256") return false;
    const expected = createHmac("sha256", Buffer.from(secret, "utf8")).update(`${header}.${payload}`).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
    const claims = JSON.parse(decode(payload)) as { exp?: number; nbf?: number };
    // A minute of leeway for clock skew.
    return typeof claims.exp === "number" && claims.exp > now - 60 && (claims.nbf === undefined || claims.nbf <= now + 60);
  } catch {
    return false;
  }
}

/**
 * Checks the API key an organization saved with the backend's URL (Project settings → Review Deck): how a
 * self-hosted backend, which can't know the publisher's certificate secret, knows the caller.
 */
export function verifyApiKey(presented: string, key: string): boolean {
  // Hashing first makes the comparison constant-time whatever the lengths.
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return key.length > 0 && timingSafeEqual(digest(presented), digest(key));
}

function decode(part: string): string {
  return Buffer.from(part, "base64url").toString("utf8");
}
