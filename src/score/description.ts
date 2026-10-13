import type { HunkInfo } from "../core/types.js";

/**
 * One step of the PR description: a top-level list item, a heading's section, or a paragraph. Authors who list
 * the PR's parts (with the files and symbols each touches) tell the pipeline which hunks belong together.
 */
export interface DescriptionStep {
  /** 1-based, in description order. */
  index: number;
  /** First line, without list markers or markdown, for evidence. */
  label: string;
  /** The whole step, for embeddings. */
  text: string;
  /** File or directory mentions, normalized (no backticks, braces expanded). Directories end in "/". */
  paths: string[];
  /** Identifier mentions: anything in backticks, plus camelCase / PascalCase / snake_case words. */
  symbols: Set<string>;
}

/** How strongly a hunk belongs to each step it matched, keyed by step index. */
export type StepAffinity = Map<number, number>;

const LIST_ITEM = /^(\s*)(?:\d+[.)]|[-*+])\s+/;
const HEADING = /^#{1,6}\s+/;
const CODE_SPAN = /`([^`]+)`/g;
/** Words that are identifiers rather than English: an inner capital, or an underscore between letters. */
const IDENTIFIER_WORD = /\b(?:[a-z]+[A-Z][\w$]*|[A-Z][a-z0-9]+[A-Z][\w$]*|[A-Za-z]+_[\w$]+)\b/g;
const PATH_LIKE = /^[\w@.~-]*(?:[/{}*][\w@.,~{}*-]*)+$|^[\w@.-]+\.[a-z][a-z0-9]{0,5}$/i;

/** Splits a description into steps; prose without lists or headings is split into paragraphs. */
export function parseDescriptionSteps(description: string): DescriptionStep[] {
  const lines = description.replace(/\r\n?/g, "\n").split("\n");
  const listIndents = lines.flatMap((l) => (LIST_ITEM.test(l) ? [LIST_ITEM.exec(l)![1].length] : []));
  const topIndent = listIndents.length ? Math.min(...listIndents) : 0;

  const blocks: string[][] = [];
  let current: string[] | null = null;
  let blank = false;
  for (const line of lines) {
    if (!line.trim()) {
      blank = true;
      continue;
    }
    const item = LIST_ITEM.exec(line);
    const startsStep =
      HEADING.test(line) ||
      (item && item[1].length <= topIndent) ||
      // A new paragraph, unless it is indented under a list item.
      (blank && !item && !/^\s/.test(line)) ||
      current === null;
    if (startsStep) blocks.push((current = []));
    current!.push(line);
    blank = false;
  }

  return blocks.map((block, i) => {
    const text = block.join("\n");
    return { index: i + 1, label: labelOf(block[0]), text, paths: pathMentions(text), symbols: symbolMentions(text) };
  });
}

function labelOf(line: string): string {
  const body = line.replace(HEADING, "").replace(LIST_ITEM, "");
  // "**Schema on the definition.** A client definition can ..." is labeled by its bold lead.
  const lead = /^\*\*([^*]+)\*\*/.exec(body);
  const plain = (lead ? lead[1] : body)
    .replace(/\*\*|__|`/g, "")
    .replace(/\s*\(.*$/, "")
    .trim();
  return plain.length > 60 ? `${plain.slice(0, 57)}...` : plain;
}

function pathMentions(text: string): string[] {
  // Prose splits at spaces and punctuation, but not at the commas inside `{a,b}`.
  const prose = text.replace(CODE_SPAN, " ").match(/(?:\{[^{}\s]*\}|[^\s,;()])+/g) ?? [];
  const candidates = [...text.matchAll(CODE_SPAN)].map((m) => m[1]).concat(prose);
  const paths = new Set<string>();
  for (const raw of candidates) {
    const word = raw.replace(/^[`'"*(<[]+|[`'"*)>\].,:;!?]+$/g, "");
    if (!word || /^https?:/.test(word) || !PATH_LIKE.test(word) || !/[a-z]/i.test(word)) continue;
    // Only things that look like files or folders: a slash, or a file extension.
    if (!word.includes("/") && !/\.[a-z][a-z0-9]{0,5}$/i.test(word)) continue;
    for (const expanded of expandBraces(word)) {
      const p = expanded.replace(/^\.?\//, "").replace(/\/\*+$|\/\*\*\/.*$/, "/");
      if (p.includes("*") || p === "/" || /^\.+$/.test(p)) continue;
      paths.add(p);
    }
  }
  return [...paths];
}

/** `a/{b,c}/d.ts` -> `a/b/d.ts`, `a/c/d.ts` (the first brace group; nesting is rare in prose). */
function expandBraces(word: string): string[] {
  const m = /\{([^{}]*)\}/.exec(word);
  if (!m) return [word];
  return m[1].split(",").flatMap((part) => expandBraces(word.slice(0, m.index) + part + word.slice(m.index + m[0].length)));
}

function symbolMentions(text: string): Set<string> {
  const symbols = new Set<string>();
  const add = (s: string) => {
    const name = s.replace(/\(.*$/, "").replace(/^[.#]/, "");
    if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(name) && name.length > 2) {
      symbols.add(name);
      // `Class.member` also names `member`.
      if (name.includes(".")) symbols.add(name.split(".").pop()!);
    }
  };
  for (const m of text.matchAll(CODE_SPAN)) for (const part of m[1].split(/[\s,]+/)) add(part);
  for (const m of text.replace(CODE_SPAN, " ").matchAll(IDENTIFIER_WORD)) add(m[0]);
  return symbols;
}

export interface AffinityOptions {
  /** Unit-normalized embeddings per hunk ID, when the semantic signal is on. */
  hunkEmbeddings: Map<string, number[]> | null;
  /** One unit-normalized embedding per step, same order as `steps`. */
  stepEmbeddings: number[][] | null;
  /** Cosine at or below this gives no semantic affinity. */
  semanticFloor: number;
}

/** Strength of a path match: the file itself, its test, or a folder above it. */
const PATH_SCORE = { file: 1, test: 0.85, folder: 0.75 };
/** A step names a symbol the hunk changes, or only one it uses. */
const SYMBOL_SCORE = { defines: 0.8, references: 0.4 };
/** Semantic affinity is scaled down: a guess from wording, not something the author named. */
const SEMANTIC_SCALE = 0.6;
/** A hunk joins every step within this share of its strongest match (so ties keep both). */
const NEAR_BEST = 0.85;

/**
 * Which steps each hunk belongs to. Path mentions are the strongest evidence, then symbols the hunk changes,
 * then wording similarity. Symbols mentioned by a step but changed in most of the PR's hunks are ignored.
 */
export function stepAffinities(hunks: HunkInfo[], steps: DescriptionStep[], options: AffinityOptions): Map<string, StepAffinity> {
  const result = new Map<string, StepAffinity>();
  if (steps.length < 2) return result;

  const symbolDf = new Map<string, number>();
  for (const h of hunks) for (const s of hunkSymbols(h).all) symbolDf.set(s, (symbolDf.get(s) ?? 0) + 1);
  const common = (s: string) => (symbolDf.get(s) ?? 0) > Math.max(2, hunks.length / 2);

  for (const h of hunks) {
    const { changed, used } = hunkSymbols(h);
    const raw = new Map<number, number>();
    steps.forEach((step, i) => {
      let score = pathScore(h.file.path, step.paths);
      for (const s of step.symbols) {
        if (common(s)) continue;
        if (changed.has(s)) score = Math.max(score, SYMBOL_SCORE.defines);
        else if (used.has(s)) score = Math.max(score, SYMBOL_SCORE.references);
      }
      const he = options.hunkEmbeddings?.get(h.hunk.id);
      const se = options.stepEmbeddings?.[i];
      if (he && se) {
        const floor = options.semanticFloor;
        score = Math.max(score, SEMANTIC_SCALE * Math.max(0, (dot(he, se) - floor) / (1 - floor)));
      }
      if (score > 0) raw.set(step.index, score);
    });
    const best = Math.max(0, ...raw.values());
    if (best === 0) continue;
    result.set(h.hunk.id, new Map([...raw].filter(([, s]) => s >= best * NEAR_BEST)));
  }
  return result;
}

function pathScore(path: string, mentions: string[]): number {
  let score = 0;
  const testFree = path.replace(/\.(test|spec)(\.[^./]+)$/, "$2");
  const isTest = testFree !== path;
  for (const m of mentions) {
    if (m.endsWith("/")) {
      if (path.startsWith(m) || path.includes(`/${m}`)) score = Math.max(score, PATH_SCORE.folder);
    } else if (matchesFile(path, m)) score = Math.max(score, PATH_SCORE.file);
    else if (isTest && matchesFile(testFree, m)) score = Math.max(score, PATH_SCORE.test);
  }
  return score;
}

/** `m` is the whole path or a trailing part of it, cut at a slash (`GitManager.ts`, `git/GitManager.ts`). */
function matchesFile(path: string, m: string): boolean {
  return path === m || path.endsWith(`/${m}`);
}

const hunkSymbolsCache = new WeakMap<HunkInfo, { changed: Set<string>; used: Set<string>; all: Set<string> }>();

function hunkSymbols(h: HunkInfo) {
  let cached = hunkSymbolsCache.get(h);
  if (!cached) {
    const changed = new Set<string>();
    const addName = (set: Set<string>, s: string) => {
      set.add(s);
      if (s.includes(".")) set.add(s.split(".").pop()!);
    };
    for (const s of [...h.defines, ...h.addedDecls, ...h.removedDecls]) addName(changed, s);
    if (h.symbol) addName(changed, h.symbol);
    const used = new Set<string>();
    for (const s of h.references) addName(used, s.replace(/^\./, ""));
    cached = { changed, used, all: new Set([...changed, ...used]) };
    hunkSymbolsCache.set(h, cached);
  }
  return cached;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
