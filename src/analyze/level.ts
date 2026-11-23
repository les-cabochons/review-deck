import type { Group, HunkInfo, ReviewLevel } from "../core/types.js";

/** How many rule names a must-read reason lists before "and N more". */
const RULES_NAMED = 3;

/**
 * How closely a concern needs reading, from its hunks' facts, with the reason in one line. Null for an ordinary
 * concern: rules can tell that a change is risky or mechanical, not that it is safe to skim.
 *
 * - `must`: a safety rule hit one of its hunks (src/analyze/safety.ts).
 * - `skip`: the mechanical group (lockfiles, generated files, pure renames).
 * - `skim`: every hunk changes comments only.
 */
export function reviewLevel(group: Group, hunks: HunkInfo[]): { level: ReviewLevel; reason: string } | null {
  const findings = hunks.flatMap((h) => h.findings);
  if (findings.length > 0) {
    // High severity first, each rule once.
    const rules = [...new Set([...findings].sort((a, b) => Number(b.severity === "high") - Number(a.severity === "high")).map((f) => f.rule))];
    const more = rules.length > RULES_NAMED ? ` and ${rules.length - RULES_NAMED} more` : "";
    return { level: "must", reason: `Safety rules hit: ${rules.slice(0, RULES_NAMED).join(", ")}${more}.` };
  }
  if (group.kind === "mechanical") return { level: "skip", reason: "Mechanical changes: nothing to review line by line." };
  if (hunks.length > 0 && hunks.every((h) => h.commentOnly)) return { level: "skim", reason: "Comments only: no code changes." };
  return null;
}
