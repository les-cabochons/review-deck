import { Language, Parser, type Tree } from "web-tree-sitter";

export type WasmSource = string | URL | Uint8Array;

export interface GrammarSources {
  typescript: WasmSource;
  tsx: WasmSource;
}

export type LanguageId = "typescript" | "tsx";

/**
 * Holds one web-tree-sitter parser per grammar. The caller supplies where the
 * .wasm files live (file paths in Node, URLs in the browser).
 */
export class SyntaxParsers {
  private constructor(private readonly parsers: Map<LanguageId, Parser>) {}

  static async create(grammars: GrammarSources, init?: Parameters<typeof Parser.init>[0]): Promise<SyntaxParsers> {
    await Parser.init(init);
    const parsers = new Map<LanguageId, Parser>();
    for (const id of ["typescript", "tsx"] as const) {
      const parser = new Parser();
      parser.setLanguage(await Language.load(grammars[id]));
      parsers.set(id, parser);
    }
    return new SyntaxParsers(parsers);
  }

  languageFor(path: string): LanguageId | null {
    if (/\.(ts|mts|cts)$/.test(path)) return "typescript";
    if (/\.(tsx|jsx|js|mjs|cjs)$/.test(path)) return "tsx";
    return null;
  }

  parse(path: string, source: string): Tree | null {
    const lang = this.languageFor(path);
    if (!lang) return null;
    return this.parsers.get(lang)!.parse(source);
  }
}
