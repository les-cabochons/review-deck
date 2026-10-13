import { spawn } from "node:child_process";
import { buildPrompt, matchTitles, parseTitles, type PromptContext, promptGroups } from "../title/prompt.js";
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

  async title(inputs: TitleInput[], context: PromptContext): Promise<GroupTitle[]> {
    const prompt = buildPrompt(promptGroups(inputs), context);
    const [cmd, ...args] = COMMANDS[this.cli];
    if (this.opts.model) args.push(this.cli === "claude" ? "--model" : "-m", this.opts.model);
    const output = await run(cmd, args, prompt, this.opts.timeoutMs ?? 180_000);
    return matchTitles(inputs, parseTitles(output));
  }
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
