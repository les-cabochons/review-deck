import { spawn } from "node:child_process";
import { describeGroup } from "../title/heuristic.js";
import type { GroupTitle, TitleInput, Titler } from "../title/types.js";

export type LlmCli = "claude" | "codex";

const COMMANDS: Record<LlmCli, string[]> = {
  // Prompt is passed on stdin in both cases.
  claude: ["claude", "-p", "--output-format", "text"],
  codex: ["codex", "exec", "--skip-git-repo-check", "-"],
};

/** Titles groups by shelling out to a local agent CLI with one prompt for the whole PR. */
export class CliLlmTitler implements Titler {
  readonly name: string;

  constructor(
    private readonly cli: LlmCli,
    private readonly opts: { model?: string; timeoutMs?: number } = {},
  ) {
    this.name = `llm:${cli}`;
  }

  async title(inputs: TitleInput[], context: { prTitle: string; prDescription: string }): Promise<GroupTitle[]> {
    const prompt = buildPrompt(inputs, context);
    const [cmd, ...args] = COMMANDS[this.cli];
    if (this.opts.model) args.push(this.cli === "claude" ? "--model" : "-m", this.opts.model);
    const output = await run(cmd, args, prompt, this.opts.timeoutMs ?? 180_000);
    const parsed = extractJsonArray(output) as { id: string; title: string; rationale: string }[];
    const byId = new Map(parsed.map((p) => [String(p.id), p]));
    return inputs.map((i) => {
      const t = byId.get(i.group.id);
      return t?.title ? { title: t.title.trim(), rationale: (t.rationale ?? "").trim() } : describeGroup(i);
    });
  }
}

export function buildPrompt(inputs: TitleInput[], context: { prTitle: string; prDescription: string }): string {
  const sections = inputs.map(({ group, hunks }) => {
    const budget = Math.max(12, Math.floor(160 / inputs.length));
    const body: string[] = [];
    for (const h of hunks) {
      body.push(`--- ${h.hunk.id}${h.symbol ? ` (${h.symbol})` : ""}`);
      const changed = h.hunk.lines.filter((l) => l.kind !== "ctx").map((l) => `${l.kind === "add" ? "+" : "-"}${l.text}`);
      body.push(...changed.slice(0, Math.max(3, Math.floor(budget / hunks.length))));
    }
    return `### Group ${group.id}\n${body.join("\n")}`;
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

function run(cmd: string, args: string[], stdin: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // On Windows the CLIs are .cmd/.ps1 shims that need a shell; args are fixed flags, never user text.
    const child =
      process.platform === "win32"
        ? spawn([cmd, ...args].join(" "), { shell: true, stdio: ["pipe", "pipe", "pipe"] })
        : spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited ${code}: ${err.slice(-500)}`));
    });
    child.stdin.end(stdin);
  });
}

function extractJsonArray(text: string): unknown[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error(`no JSON array in LLM output: ${text.slice(0, 200)}`);
  const value = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(value)) throw new Error("LLM output is not an array");
  return value;
}
