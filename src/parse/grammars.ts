// The tree-sitter grammars, the npm package shipping each .wasm, and the file extensions each
// parses. Plain data with no imports: extension/build.mjs imports this file directly to copy the
// grammars into the extension.

export const GRAMMARS = {
  typescript: { package: "tree-sitter-typescript", file: "tree-sitter-typescript.wasm", extensions: ["ts", "mts", "cts"] },
  tsx: { package: "tree-sitter-typescript", file: "tree-sitter-tsx.wasm", extensions: ["tsx", "jsx", "js", "mjs", "cjs"] },
  python: { package: "tree-sitter-python", file: "tree-sitter-python.wasm", extensions: ["py", "pyi"] },
  go: { package: "tree-sitter-go", file: "tree-sitter-go.wasm", extensions: ["go"] },
  rust: { package: "tree-sitter-rust", file: "tree-sitter-rust.wasm", extensions: ["rs"] },
  java: { package: "tree-sitter-java", file: "tree-sitter-java.wasm", extensions: ["java"] },
  csharp: { package: "tree-sitter-c-sharp", file: "tree-sitter-c_sharp.wasm", extensions: ["cs"] },
  ruby: { package: "tree-sitter-ruby", file: "tree-sitter-ruby.wasm", extensions: ["rb", "rake", "gemspec"] },
  php: { package: "tree-sitter-php", file: "tree-sitter-php.wasm", extensions: ["php"] },
  // C parses with the C++ grammar, a superset close enough for symbols.
  cpp: {
    package: "tree-sitter-cpp",
    file: "tree-sitter-cpp.wasm",
    extensions: ["c", "h", "cc", "cpp", "cxx", "c++", "hh", "hpp", "hxx", "ipp", "inl", "ino"],
  },
} as const;

export type LanguageId = keyof typeof GRAMMARS;
export type Grammar = (typeof GRAMMARS)[LanguageId];
