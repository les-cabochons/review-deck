import { describeGroup } from "./heuristic.js";
import type { GroupTitle, TitleInput } from "./types.js";

/** What an LLM sees of a group: hunk IDs, symbols and changed lines. Serializable, so it can go over HTTP. */
export interface PromptGroup {
  id: string;
  hunks: { id: string; symbol: string | null; changed: string[] }[];
}

export interface PromptContext {
  prTitle: string;
  prDescription: string;
}

export interface LlmTitle {
  id: string;
  title: string;
  rationale: string;
}

/** The changed lines of each hunk, trimmed to a budget of ~160 lines for the whole PR. */
export function promptGroups(inputs: TitleInput[]): PromptGroup[] {
  const budget = Math.max(12, Math.floor(160 / inputs.length));
  return inputs.map(({ group, hunks }) => ({
    id: group.id,
    hunks: hunks.map((h) => ({
      id: h.hunk.id,
      symbol: h.symbol,
      changed: h.hunk.lines
        .filter((l) => l.kind !== "ctx")
        .map((l) => `${l.kind === "add" ? "+" : "-"}${l.text}`)
        .slice(0, Math.max(3, Math.floor(budget / hunks.length))),
    })),
  }));
}

export function buildPrompt(groups: PromptGroup[], context: PromptContext): string {
  const sections = groups.map(({ id, hunks }) => {
    const body: string[] = [];
    for (const h of hunks) {
      body.push(`--- ${h.id}${h.symbol ? ` (${h.symbol})` : ""}`);
      body.push(...h.changed);
    }
    return `### Group ${id}\n${body.join("\n")}`;
  });
  return [
    "You are helping a code reviewer. A pull request's diff hunks have been clustered into groups of related changes.",
    "For each group, write a short title (imperative mood, max 8 words, like a commit subject) and a one-sentence rationale",
    "explaining why these hunks belong together. Do not use tools; answer from the text below.",
    "",
    `PR title: ${context.prTitle}`,
    `PR description: ${context.prDescription}`,
    "",
    ...sections,
    "",
    'Respond with ONLY a JSON array, no prose, no code fences: [{"id": "<group id>", "title": "...", "rationale": "..."}]',
  ].join("\n");
}

/** The JSON array in an LLM's answer, tolerating prose or code fences around it. */
export function parseTitles(text: string): LlmTitle[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error(`no JSON array in LLM output: ${text.slice(0, 200)}`);
  const value = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(value)) throw new Error("LLM output is not an array");
  return value
    .filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
    .map((v) => ({ id: String(v.id), title: String(v.title ?? "").trim(), rationale: String(v.rationale ?? "").trim() }));
}

/** LLM titles in input order; groups the LLM skipped keep their heuristic title. */
export function matchTitles(inputs: TitleInput[], titles: LlmTitle[]): GroupTitle[] {
  const byId = new Map(titles.map((t) => [t.id, t]));
  return inputs.map((i) => {
    const t = byId.get(i.group.id);
    return t?.title ? { title: t.title, rationale: t.rationale } : describeGroup(i);
  });
}
