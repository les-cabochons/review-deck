import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { SyntaxParsers } from "../parse/treesitter.js";

const require = createRequire(import.meta.url);

/** Loads the TypeScript/TSX grammars shipped as .wasm in the tree-sitter-typescript package. */
export function createNodeParsers(): Promise<SyntaxParsers> {
  const dir = dirname(require.resolve("tree-sitter-typescript/package.json"));
  return SyntaxParsers.create({
    typescript: join(dir, "tree-sitter-typescript.wasm"),
    tsx: join(dir, "tree-sitter-tsx.wasm"),
  });
}
