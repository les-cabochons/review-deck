import type { PipelineConfig } from "../core/config.js";
import { dirname, isTestPath, join, stripExtension } from "../core/paths.js";
import type { FileDiff, FileProvider, Hunk, HunkInfo, Side } from "../core/types.js";
import type { LanguageId } from "../parse/grammars.js";
import { LANGUAGES, languageForPath } from "../parse/languages.js";
import { type Decl, declKey, type FileSymbols, type ImportRef, innermostDecl } from "../parse/symbols.js";
import type { SyntaxParsers } from "../parse/treesitter.js";
import { detectMechanical, prHasLockfileChange } from "./mechanical.js";

const IMPACT_KINDS = new Set<Decl["kind"]>(["function", "variable", "class", "interface", "type", "enum"]);

interface FileSides {
  content: Record<Side, string | null>;
  symbols: Record<Side, FileSymbols | null>;
}

/** Enriches every hunk with symbols, references and mechanical-change flags. */
export async function analyzeHunks(
  files: FileDiff[],
  provider: FileProvider,
  parsers: SyntaxParsers,
  config: PipelineConfig,
  onProgress?: (progress: { stage: "parse"; done: number; total: number }) => void,
): Promise<Map<string, HunkInfo>> {
  const stopFilters = new Map<string | null, (name: string) => boolean>();
  const stopFor = (language: LanguageId | null) => {
    let stop = stopFilters.get(language);
    if (!stop) {
      const extra = (language && LANGUAGES[language].stopwords) || [];
      stopFilters.set(language, (stop = makeStopFilter([...config.stopwords, ...extra])));
    }
    return stop;
  };
  const lockfileChanged = prHasLockfileChange(files);
  const changedPaths = files.flatMap((f) => [f.oldPath, f.newPath]).filter((p): p is string => !!p);
  const changedModules = changedPaths.map(stripExtension);
  // Non-relative imports resolve against every changed module; the same import recurs across files.
  const resolved = new Map<string, string[]>();
  const resolveModule = (ref: ImportRef) => {
    const key = `${ref.match}:${ref.path}`;
    let modules = resolved.get(key);
    if (!modules) resolved.set(key, (modules = resolveImport(ref, changedModules)));
    return modules;
  };
  const out = new Map<string, HunkInfo>();
  await parsers.load(changedPaths);

  for (const [i, file] of files.entries()) {
    onProgress?.({ stage: "parse", done: i, total: files.length });
    const sides = await loadSides(file, provider, parsers);
    const head = (sides.content.new ?? sides.content.old ?? "").split("\n").slice(0, 5).join("\n");
    const imports = resolveImports(file, sides, resolveModule);
    const language = languageForPath(file.path);
    for (const hunk of file.hunks) {
      const info = analyzeHunk(file, hunk, sides, stopFor(language), imports, language);
      info.mechanical = detectMechanical(file, hunk, { lockfileChanged, head });
      out.set(hunk.id, info);
    }
  }
  return out;
}

async function loadSides(file: FileDiff, provider: FileProvider, parsers: SyntaxParsers): Promise<FileSides> {
  const oldContent = file.oldPath && file.status !== "added" ? await provider.get(file.oldPath, "old") : null;
  const newContent = file.newPath && file.status !== "deleted" ? await provider.get(file.newPath, "new") : null;
  const parse = (path: string | null, content: string | null) => (path && content !== null ? parsers.symbols(path, content) : null);
  return {
    content: { old: oldContent, new: newContent },
    symbols: { old: parse(file.oldPath, oldContent), new: parse(file.newPath, newContent) },
  };
}

function resolveImports(file: FileDiff, sides: FileSides, resolveModule: (ref: ImportRef) => string[]): Set<string> {
  const out = new Set<string>();
  for (const side of ["old", "new"] as const) {
    const path = side === "old" ? file.oldPath : file.newPath;
    const syms = sides.symbols[side];
    if (!path || !syms) continue;
    for (const ref of syms.imports) {
      if (ref.path.startsWith(".")) out.add(stripExtension(join(dirname(path), ref.path)));
      else for (const m of resolveModule(ref)) out.add(m);
    }
  }
  return out;
}

function analyzeHunk(
  file: FileDiff,
  hunk: Hunk,
  sides: FileSides,
  stop: (name: string) => boolean,
  fileImports: Set<string>,
  language: string | null,
): HunkInfo {
  const defines = new Set<string>();
  const references = new Set<string>();
  const tokens = new Set<string>();
  const enclosing = new Set<string>();
  const impacts = new Set<string>();
  let symbol: string | null = null;
  let anyCode = false;
  let anyComment = false;
  const changedDeclRows: Record<Side, Set<number>> = { old: new Set(), new: new Set() };
  const innermostBySide: Record<Side, Decl[]> = { old: [], new: [] };

  for (const side of ["new", "old"] as const) {
    const kind = side === "new" ? "add" : "del";
    const rows = hunk.lines
      .filter((l) => l.kind === kind)
      .map((l) => (side === "new" ? l.newLine! : l.oldLine!) - 1);
    const syms = sides.symbols[side];
    for (const row of rows) {
      changedDeclRows[side].add(row);
      if (!syms) {
        // Unparsed language: fall back to a regex tokenizer for lexical overlap only.
        const text = hunk.lines.find((l) => (side === "new" ? l.newLine : l.oldLine) === row + 1)?.text ?? "";
        if (text.trim()) anyCode = true;
        for (const m of text.matchAll(/[A-Za-z_$][\w$-]{2,}/g)) if (!stop(m[0])) tokens.add(m[0]);
        continue;
      }
      const facts = syms.lines.get(row);
      if (facts) {
        if (facts.hasCode) anyCode = true;
        if (facts.comments.length > 0) anyComment = true;
        for (const id of facts.idents) {
          if (stop(id.text)) continue;
          for (const key of id.keys) {
            (id.isDefName ? defines : references).add(key);
            tokens.add(key);
          }
        }
        for (const s of facts.strings) {
          const norm = s.trim().toLowerCase();
          if (norm.length >= 4) tokens.add(`"${norm}"`);
        }
      }
      const decl = innermostDecl(syms.decls, row);
      if (decl) {
        innermostBySide[side].push(decl);
        enclosing.add(decl.qualified);
        if (decl.kind !== "test") {
          if (!stop(decl.name)) defines.add(declKey(decl));
          // Constructor changes stand for the class itself (`new Foo(...)` references Foo).
          if (decl.constructs) defines.add(decl.constructs);
        }
        symbol ??= decl.qualified;
      } else if (facts?.isImport) {
        symbol ??= "(imports)";
      }
    }
  }
  defines.delete("");

  // Declarations introduced or removed by this hunk.
  const declNames = (side: Side) =>
    (sides.symbols[side]?.decls ?? []).filter((d) => changedDeclRows[side].has(d.nameRow) && d.kind !== "test");
  const oldQualified = new Set((sides.symbols.old?.decls ?? []).map((d) => d.qualified));
  const newQualified = new Set((sides.symbols.new?.decls ?? []).map((d) => d.qualified));
  const added = declNames("new").filter((d) => !oldQualified.has(d.qualified));
  const removed = declNames("old").filter((d) => !newQualified.has(d.qualified));
  for (const d of [...added, ...removed]) if (!stop(d.name)) defines.add(declKey(d));
  const addedDecls = added.map((d) => d.qualified);
  const removedDecls = removed.map((d) => d.qualified);

  // One hop of impact: unchanged declarations in this file that use something this hunk changed.
  for (const side of ["new", "old"] as const) {
    const rows = [...changedDeclRows[side]];
    for (const d of sides.symbols[side]?.decls ?? []) {
      if (rows.some((r) => r >= d.startRow && r <= d.endRow)) continue; // contains the change itself
      // Methods/fields are referenced as `x.name`, which is too ambiguous to follow; only module-level decls count.
      if (!IMPACT_KINDS.has(d.kind) || enclosing.has(d.qualified) || stop(d.name) || defines.has(d.name)) continue;
      if ([...defines].some((s) => d.refs.has(s))) impacts.add(d.name);
    }
  }

  if (!symbol && file.status === "added") symbol = "(new file)";

  return {
    hunk,
    file,
    language,
    isTest: isTestPath(file.path),
    symbol,
    enclosing: [...enclosing],
    defines,
    impacts,
    references,
    tokens,
    fileImports,
    commentOnly: anyComment && !anyCode,
    addedDecls,
    removedDecls,
    mechanical: null,
    text: hunkText(file, hunk, symbol),
  };
}

function hunkText(file: FileDiff, hunk: Hunk, symbol: string | null): string {
  const changed = hunk.lines
    .filter((l) => l.kind !== "ctx")
    .slice(0, 40)
    .map((l) => `${l.kind === "add" ? "+" : "-"} ${l.text.trim()}`);
  return `${file.path}${symbol ? ` :: ${symbol}` : ""}\n${changed.join("\n")}`;
}

export function makeStopFilter(stopwords: string[]): (name: string) => boolean {
  const set = new Set(stopwords);
  return (name) => name.length < 3 || set.has(name) || /^(to|mock)[A-Z]/.test(name);
}

function resolveImport(ref: ImportRef, changedModules: string[]): string[] {
  if (ref.match === "package") return resolvePackageImport(ref.path, changedModules);
  const target = stripExtension(ref.path).toLowerCase();
  if (!target) return [];
  const endsWith = (m: string) => m === target || m.endsWith(`/${target}`);
  if (ref.match === "suffix") return changedModules.filter((m) => endsWith(m.toLowerCase()));
  // Directory imports name a package path (`github.com/acme/app/internal/util`, `Acme.App.Util`)
  // whose repo-relative directory is a suffix of it, or ends in it.
  return changedModules.filter((m) => {
    const dir = dirname(m).toLowerCase();
    return dir !== "" && (dir === target || target.endsWith(`/${dir}`) || dir.endsWith(`/${target}`));
  });
}

/**
 * Monorepo package imports (`@scope/pkg/sub/path`, `pkg/sub`) resolved by convention against the
 * PR's changed files: a module under a `pkg/` directory ending in `/sub` (or `/src/sub`). A bare
 * package import matches every changed module of that package. No tsconfig/package.json reading.
 */
function resolvePackageImport(spec: string, changedModules: string[]): string[] {
  const parts = spec.split("/");
  const [pkg, sub] = spec.startsWith("@") ? [parts[1], parts.slice(2).join("/")] : [parts[0], parts.slice(1).join("/")];
  if (!pkg) return [];
  const inPackage = changedModules.filter((m) => m.startsWith(`${pkg}/`) || m.includes(`/${pkg}/`));
  if (!sub) return inPackage;
  const target = stripExtension(sub);
  return inPackage.filter((m) => m.endsWith(`/${target}`) || m.endsWith(`/${target}/index`));
}
