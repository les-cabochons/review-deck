import { Language, Parser } from "web-tree-sitter";
import { type Grammar, GRAMMARS, type LanguageId } from "./grammars.js";
import { LANGUAGES, languageForPath } from "./languages.js";
import { extractSymbols, type FileSymbols } from "./symbols.js";

export type WasmSource = string | URL | Uint8Array;

/**
 * Parses source files into symbols, one web-tree-sitter parser per grammar. Grammars load on demand
 * (`load` before `symbols`), so a PR only fetches the grammars of the languages it touches. The
 * caller says where each .wasm lives (file paths in Node, URLs in the browser).
 */
export class SyntaxParsers {
  private readonly parsers = new Map<LanguageId, Parser>();
  private readonly loading = new Map<LanguageId, Promise<void>>();

  private constructor(private readonly locate: (grammar: Grammar) => WasmSource) {}

  static async create(locate: (grammar: Grammar) => WasmSource, init?: Parameters<typeof Parser.init>[0]): Promise<SyntaxParsers> {
    await Parser.init(init);
    return new SyntaxParsers(locate);
  }

  /**
   * Loads the grammars `paths` need. A grammar that fails to load is reported and its files are
   * grouped like unparsed ones, rather than failing the whole review.
   */
  async load(paths: Iterable<string>): Promise<void> {
    const ids = new Set<LanguageId>();
    for (const path of paths) {
      const id = languageForPath(path);
      if (id) ids.add(id);
    }
    await Promise.all([...ids].map((id) => this.loadGrammar(id)));
  }

  private loadGrammar(id: LanguageId): Promise<void> {
    let pending = this.loading.get(id);
    if (!pending) {
      pending = Language.load(this.locate(GRAMMARS[id])).then(
        (language) => {
          const parser = new Parser();
          parser.setLanguage(language);
          this.parsers.set(id, parser);
        },
        (e) => console.warn(`review-deck: could not load the ${id} grammar; its files are grouped by path and names only`, e),
      );
      this.loading.set(id, pending);
    }
    return pending;
  }

  /** Symbols of `source`, or null when its language has no (loaded) grammar. */
  symbols(path: string, source: string): FileSymbols | null {
    const id = languageForPath(path);
    const parser = id && this.parsers.get(id);
    if (!id || !parser) return null;
    const tree = parser.parse(source);
    if (!tree) return null;
    const symbols = extractSymbols(tree, LANGUAGES[id].spec, path);
    tree.delete();
    return symbols;
  }
}
