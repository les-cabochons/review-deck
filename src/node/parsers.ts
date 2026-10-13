import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { SyntaxParsers } from "../parse/treesitter.js";

const require = createRequire(import.meta.url);

/** Loads grammars from the .wasm files shipped in their tree-sitter-* npm packages. */
export function createNodeParsers(): Promise<SyntaxParsers> {
  return SyntaxParsers.create((grammar) => join(dirname(require.resolve(`${grammar.package}/package.json`)), grammar.file));
}
