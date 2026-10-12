import { mkdirSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

mkdirSync("extension/test-dist", { recursive: true });
await build({
  entryPoints: ["extension/tests/browser.tsx"],
  outdir: "extension/test-dist",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  external: ["fs", "fs/promises", "module", "path", "url"],
  loader: { ".woff": "file", ".woff2": "file", ".ttf": "file", ".svg": "file", ".png": "file" },
  define: { "process.env.NODE_ENV": '"development"' },
});
writeFileSync(
  "extension/test-dist/index.html",
  '<!doctype html><html><head><meta charset="utf-8"><title>Review write regression harness</title><link rel="stylesheet" href="browser.css"></head><body><div id="root"></div><script type="module" src="browser.js"></script></body></html>',
);
console.log("With npm run ext:dev running, open http://127.0.0.1:5173/test-dist/index.html");
