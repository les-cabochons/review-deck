import { type DescriptionStep, parseDescriptionSteps, stepAffinities } from "../score/description.js";
import type { GroupTitle, TitleInput } from "./types.js";

/** A group takes a step's words when at least this share of its hunks belongs to the step. */
const MIN_COVERAGE = 0.5;
const MAX_TITLE = 70;
const MAX_RATIONALE = 240;
const MARKER = /^\s*(?:\d+[.)]|[-*+]|#{1,6})\s+/;

/**
 * Titles from the PR description: a group that mostly matches one step gets that step's heading as its title and
 * the step's first sentences as its rationale, so the author's intent shows without an LLM. Each step titles at
 * most one group, the one it covers best. Null for groups no step matches.
 */
export function titlesFromDescription(inputs: TitleInput[], description: string): (GroupTitle | null)[] {
  const titles: (GroupTitle | null)[] = inputs.map(() => null);
  const steps = parseDescriptionSteps(description).filter(isTitleable);
  if (steps.length < 2) return titles;
  const affinity = stepAffinities(
    inputs.flatMap((i) => i.hunks),
    steps,
    { hunkEmbeddings: null, stepEmbeddings: null, semanticFloor: 1 },
  );

  const candidates: { group: number; step: DescriptionStep; coverage: number }[] = [];
  inputs.forEach((input, group) => {
    for (const step of steps) {
      const covered = input.hunks.filter((h) => affinity.get(h.hunk.id)?.has(step.index)).length;
      const coverage = covered / input.hunks.length;
      if (coverage >= MIN_COVERAGE) candidates.push({ group, step, coverage });
    }
  });
  const usedSteps = new Set<number>();
  for (const { group, step } of candidates.sort((a, b) => b.coverage - a.coverage || a.step.index - b.step.index)) {
    if (titles[group] || usedSteps.has(step.index)) continue;
    usedSteps.add(step.index);
    titles[group] = { title: step.label.replace(/[.:]$/, ""), rationale: summary(step), source: "description" };
  }
  return titles;
}

/** List items and headings that name a change; not lead-in paragraphs ("**Problem.** ...") or "Fix, in order:". */
function isTitleable(step: DescriptionStep): boolean {
  const first = step.text.split("\n")[0];
  if (!MARKER.test(first) || /:\**\s*$/.test(first)) return false;
  return step.label.length >= 3 && step.label.length <= MAX_TITLE && !step.label.endsWith("...");
}

/** The step after its heading, as plain prose: no markdown, no parenthesized file lists, at most two sentences. */
function summary(step: DescriptionStep): string {
  const lines = step.text.split("\n");
  // Drop the heading part, which became the title: a bold lead, or the first line up to its "(", or all of it.
  const head = lines[0].replace(MARKER, "");
  const bold = /^\*\*[^*]+\*\*/.exec(head);
  const rest = bold ? head.slice(bold[0].length) : head.includes("(") ? head.slice(head.indexOf("(")) : "";
  const text = [rest, ...lines.slice(1)]
    .join(" ")
    // File lists like (`src/a.ts`, with test) or (`GitManager.ts`): the reader sees the files.
    .replace(/\([^()]*`[^`]*(?:\/|\.[a-z][a-z0-9]{0,5})`[^()]*\)/gi, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\s+-\s+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.:;,]+/, "")
    .trim();
  // A sentence ends at punctuation followed by a capital or the end, not at the dot in `item.title`.
  const sentences = text.match(/.+?[.!?](?=\s+[A-Z"(]|\s*$)/g) ?? (text ? [text] : []);
  let out = "";
  for (const s of sentences.slice(0, 2)) {
    if (out && out.length + s.length > MAX_RATIONALE) break;
    out += s;
  }
  out = out.trim();
  if (out.length <= MAX_RATIONALE) return out;
  // One long sentence: end at its last clause that fits.
  const cut = Math.max(out.lastIndexOf(". ", MAX_RATIONALE), out.lastIndexOf(", ", MAX_RATIONALE), out.lastIndexOf("; ", MAX_RATIONALE));
  return cut > 60 ? `${out.slice(0, cut)}…` : `${out.slice(0, MAX_RATIONALE - 1).trimEnd()}…`;
}
