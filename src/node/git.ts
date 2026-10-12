import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FileProvider } from "../core/types.js";
import type { PrInput } from "../pipeline.js";

const run = promisify(execFile);

async function git(repo: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", repo, "-c", "core.autocrlf=false", ...args], { maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

/**
 * Reads a change straight from a local git repository: diff between two revisions,
 * file contents via `git show`. Nothing in the repository is executed.
 * Title/description default to the head commit's subject/body.
 */
export async function loadGitPr(
  repo: string,
  base: string,
  head: string,
  meta: { title?: string; description?: string } = {},
): Promise<PrInput> {
  const diff = await git(repo, "diff", "-M", "--no-color", "--no-ext-diff", base, head);
  const [subject, ...body] = (await git(repo, "log", "-1", "--format=%B", head)).trim().split("\n");
  const revs = { old: base, new: head } as const;
  const files: FileProvider = {
    async get(path, side) {
      try {
        return await git(repo, "show", `${revs[side]}:${path}`);
      } catch {
        return null;
      }
    },
  };
  return {
    title: meta.title ?? subject,
    description: meta.description ?? body.join(" ").replace(/\s+/g, " ").trim().slice(0, 600),
    diff,
    files,
  };
}
