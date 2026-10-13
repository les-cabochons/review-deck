/**
 * Trunk branches: where a stack ends. A PR into a trunk branch is the bottom of its stack, and
 * auto-restack never rewrites a trunk branch.
 *
 * Patterns are branch names without `refs/heads/`, matched case-insensitively (Azure DevOps refs are):
 *   main, dev, uat     exact names
 *   *\/00-*            `*` matches within one path segment (release/00-q4, not a/b/00-x)
 *   release/**         `**` matches across segments
 */
export const DEFAULT_TRUNK_PATTERNS = ["main", "master"];

export function shortBranch(ref: string): string {
  return ref.replace(/^refs\/heads\//, "");
}

export function isTrunk(branch: string, patterns: readonly string[]): boolean {
  const name = shortBranch(branch).toLowerCase();
  return patterns.some((p) => patternRegex(p).test(name));
}

/** Cleans a user-entered list: one pattern per line or comma, trimmed, deduplicated, `refs/heads/` dropped. */
export function parseTrunkPatterns(text: string): string[] {
  const patterns = text
    .split(/[\n,]/)
    .map((p) => shortBranch(p.trim()))
    .filter(Boolean);
  return [...new Set(patterns)];
}

/** Why a pattern can't be used, or null if it's fine. */
export function invalidTrunkPattern(pattern: string): string | null {
  if (/\s/.test(pattern)) return "Branch patterns can't contain spaces.";
  if (/^\*+$/.test(pattern.replace(/\//g, ""))) return "A pattern of only wildcards would treat every branch as a trunk.";
  if (/[?[\]\\^~:]/.test(pattern)) return "Only * and ** are supported as wildcards.";
  return null;
}

const cache = new Map<string, RegExp>();

function patternRegex(pattern: string): RegExp {
  const key = shortBranch(pattern.trim()).toLowerCase();
  let re = cache.get(key);
  if (!re) {
    const body = key
      .split(/(\*\*|\*)/)
      .map((part) => (part === "**" ? ".*" : part === "*" ? "[^/]*" : part.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
      .join("");
    re = new RegExp(`^${body}$`);
    cache.set(key, re);
  }
  return re;
}
