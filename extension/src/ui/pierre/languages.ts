import type { SupportedLanguages } from "@pierre/diffs";

// Every language named here needs a grammar loader in ./shiki.ts.
const extensions: Record<string, SupportedLanguages> = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  json: "json", jsonc: "jsonc", json5: "json5", jsonl: "jsonl", md: "markdown", markdown: "markdown", mdx: "mdx",
  css: "css", scss: "scss", sass: "sass", less: "less", html: "html", htm: "html", xml: "xml", svg: "xml",
  csproj: "xml", props: "xml", targets: "xml", resx: "xml", xaml: "xml", plist: "xml",
  vue: "vue", svelte: "svelte", astro: "astro", hbs: "handlebars", handlebars: "handlebars", twig: "twig",
  cshtml: "razor", razor: "razor",
  yaml: "yaml", yml: "yaml", toml: "toml", ini: "ini", cfg: "ini", conf: "ini", properties: "properties",
  env: "dotenv", csv: "csv",
  sh: "bash", bash: "bash", zsh: "zsh", fish: "fish", ps1: "powershell", psm1: "powershell", bat: "bat", cmd: "bat",
  py: "python", pyi: "python", go: "go", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin",
  scala: "scala", sc: "scala", groovy: "groovy", gradle: "groovy", swift: "swift", dart: "dart",
  cs: "csharp", fs: "fsharp", fsx: "fsharp", vb: "vb",
  c: "c", h: "cpp", cc: "cpp", cpp: "cpp", cxx: "cpp", hh: "cpp", hpp: "cpp", hxx: "cpp", ino: "cpp",
  m: "objective-c", mm: "objective-c",
  rb: "ruby", rake: "ruby", gemspec: "ruby", php: "php", pl: "perl", pm: "perl", lua: "lua", r: "r",
  ex: "elixir", exs: "elixir", erl: "erlang", hrl: "erlang", clj: "clojure", cljs: "clojure", edn: "clojure",
  hs: "haskell", ml: "ocaml", mli: "ocaml", elm: "elm", jl: "julia", zig: "zig", nim: "nim", cr: "crystal",
  sol: "solidity", nix: "nix", tex: "latex",
  sql: "sql", graphql: "graphql", gql: "graphql", proto: "proto", prisma: "prisma",
  tf: "terraform", tfvars: "terraform", hcl: "hcl", diff: "diff", patch: "diff", cmake: "cmake", mk: "makefile",
};

// Files known by name rather than extension.
const filenames: Record<string, SupportedLanguages> = {
  dockerfile: "dockerfile", containerfile: "dockerfile", makefile: "makefile", gnumakefile: "makefile",
  "cmakelists.txt": "cmake", gemfile: "ruby", rakefile: "ruby", podfile: "ruby", vagrantfile: "ruby",
  jenkinsfile: "groovy", ".bashrc": "bash", ".zshrc": "zsh", ".profile": "bash", ".gitconfig": "ini",
  ".editorconfig": "ini", "nginx.conf": "nginx",
};

/** Every language `highlightLanguage` can return besides "text". */
export const highlightedLanguages: ReadonlySet<SupportedLanguages> = new Set([...Object.values(extensions), ...Object.values(filenames)]);

export function highlightLanguage(path: string): SupportedLanguages {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (filenames[name]) return filenames[name];
  // Variants: Dockerfile.prod, .env.local.
  if (/^(dockerfile|containerfile)\./.test(name)) return "dockerfile";
  if (/^\.env(\.|$)/.test(name)) return "dotenv";
  const dot = name.lastIndexOf(".");
  return (dot > 0 && extensions[name.slice(dot + 1)]) || "text";
}
