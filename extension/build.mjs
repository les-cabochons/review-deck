// Bundles the review page for Azure DevOps (and for local dev with mock data).
//   node extension/build.mjs            -> extension/dist + extension/assets (production, minified)
//   node extension/build.mjs --serve    -> watch + serve on http://127.0.0.1:5173/dist/review.html
import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const serve = process.argv.includes("--serve");
const require = createRequire(import.meta.url);

mkdirSync(dist, { recursive: true });
cpSync(join(here, "static"), dist, { recursive: true });
// tree-sitter runtime + grammars load at runtime from ../assets: a separate folder so the
// manifest can give them the application/wasm content type.
const assets = join(here, "assets");
mkdirSync(assets, { recursive: true });
cpSync(require.resolve("web-tree-sitter/web-tree-sitter.wasm"), join(assets, "web-tree-sitter.wasm"));
const grammars = dirname(require.resolve("tree-sitter-typescript/package.json"));
for (const g of ["tree-sitter-typescript.wasm", "tree-sitter-tsx.wasm"]) cpSync(join(grammars, g), join(assets, g));

const options = {
  entryPoints: { review: join(here, "src", "index.tsx"), action: join(here, "src", "action.ts") },
  outdir: dist,
  bundle: true,
  format: "esm",
  splitting: true,
  target: "es2022",
  platform: "browser",
  sourcemap: serve ? "inline" : "linked",
  minify: !serve,
  loader: { ".woff": "file", ".woff2": "file", ".ttf": "file", ".svg": "file", ".png": "file" },
  // web-tree-sitter's Node code paths are never taken in the browser.
  external: ["fs", "fs/promises", "module", "path", "url"],
  define: { "process.env.NODE_ENV": serve ? '"development"' : '"production"' },
  logLevel: "info",
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  // Serve the extension root so dist/, assets/ and dev-data/ keep the same relative layout as the .vsix.
  const { port } = await ctx.serve({ servedir: here, host: "127.0.0.1", port: 5173 });
  console.log(`\n  http://127.0.0.1:${port}/dist/review.html?mock=t3code-17901\n`);
} else {
  await esbuild.build(options);
}
