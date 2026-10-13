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
    "You are helping a code reviewer read a pull request. Its diff hunks have been clustered into groups of related",
    "changes; each hunk is headed by its id (file path#index) and, when known, the symbol it changes.",
    "",
    "Present the groups as a story: the steps a reviewer should read, in order, to understand what the PR does and why.",
    "Use the PR title and description for the author's intent. The groups below are in dependency order (definitions",
    "before their uses); keep that unless another order makes the story clearer, e.g. starting from the change that",
    "motivates the rest. Tests and docs usually belong right after the change they cover.",
    "",
    "For each group write:",
    "- title: what this step accomplishes for the PR, in imperative mood, max 8 words, like a good commit subject.",
    '  Name the behavior or concept, not the files or symbols touched. Good: "Cache titles per organization".',
    '  Bad: "Update titles.ts", "Change buildPrompt and parseTitles", "Misc fixes". Titles should read as a sequence.',
    "- rationale: one or two sentences on the intent: what this step fixes or makes possible, what behavior changes,",
    "  and how it fits the story (what it builds on or enables). The reader sees the diff right below, so don't list",
    "  files, symbols, hunk counts or how the hunks are linked, and don't repeat the title.",
    "",
    "Do not use tools; answer from the text below.",
    "",
    `PR title: ${context.prTitle}`,
    `PR description: ${context.prDescription || "(none)"}`,
    "",
    ...sections,
    "",
    "Respond with ONLY a JSON array, no prose, no code fences, with one entry per group in the order a reviewer should",
    'read them: [{"id": "<group id>", "title": "...", "rationale": "..."}]',
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

/**
 * LLM titles in input order, each with its place in the LLM's reading order (the order of its answer).
 * Groups the LLM skipped keep their heuristic title and get no position; groups it left untitled keep their position.
 */
export function matchTitles(inputs: TitleInput[], titles: LlmTitle[]): GroupTitle[] {
  const byId = new Map<string, LlmTitle & { position: number }>();
  titles.forEach((t, position) => {
    if (!byId.has(t.id)) byId.set(t.id, { ...t, position });
  });
  return inputs.map((i) => {
    const match = byId.get(i.group.id);
    if (!match) return describeGroup(i);
    return { ...(match.title ? { title: match.title, rationale: match.rationale, source: "llm" as const } : describeGroup(i)), position: match.position };
  });
}
