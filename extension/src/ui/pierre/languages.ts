import type { SupportedLanguages } from "@pierre/diffs";
const extensions: Record<string, SupportedLanguages> = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  json: "json", jsonc: "jsonc", md: "markdown", markdown: "markdown",
  css: "css", html: "html", htm: "html", yaml: "yaml", yml: "yaml", sh: "bash", bash: "bash",
};
export function highlightLanguage(path: string): SupportedLanguages {
  return extensions[path.split(".").at(-1)?.toLowerCase() ?? ""] ?? "text";
}
