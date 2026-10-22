// Bundles the review page for Azure DevOps (and for local dev with mock data).
//   node extension/build.mjs            -> extension/dist + extension/assets (production, minified)
//   node extension/build.mjs --serve    -> watch + serve on http://127.0.0.1:5173/dist/review.html
//                                          (PORT=5180 for another port, e.g. a second worktree)
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const serve = process.argv.includes("--serve");
const require = createRequire(import.meta.url);

// dist is the generated output directly inside this extension, never a source directory.
if (!serve) {
  if (dirname(dist) !== here) throw new Error("Unexpected build output directory");
  rmSync(dist, { recursive: true, force: true });
}
mkdirSync(dist, { recursive: true });
cpSync(join(here, "static"), dist, { recursive: true });
// tree-sitter runtime + grammars load at runtime from ../assets: a separate folder so the
// manifest can give them the application/wasm content type.
const assets = join(here, "assets");
mkdirSync(assets, { recursive: true });
cpSync(require.resolve("web-tree-sitter/web-tree-sitter.wasm"), join(assets, "web-tree-sitter.wasm"));
const { GRAMMARS } = await import("../src/parse/grammars.ts");
for (const g of Object.values(GRAMMARS)) {
  const pkg = dirname(require.resolve(`${g.package}/package.json`));
  cpSync(join(pkg, g.file), join(assets, g.file));
}

/**
 * The pages in static/ that have the placeholders (review, settings, org-settings, changelog): the page's skeleton and the host theme kept from the last
 * visit inline, so they paint before any script runs, and modulepreload links for every chunk the first render
 * needs, so those download alongside review.js instead of after the host handshake (src/index.ts, src/skeletons.ts).
 */
const startupHtml = {
  name: "startup-html",
  setup(build) {
    build.onEnd(async (result) => {
      if (!result.metafile) return;
      const preload = startupChunks(result.metafile)
        .map((file) => `<link rel="modulepreload" href="${file}" />`)
        .join("\n    ");
      const skeletons = await loadSkeletons();
      const byName = { hub: skeletons.hubSkeleton, settings: skeletons.settingsSkeleton };
      for (const file of readdirSync(join(here, "static")).filter((f) => f.endsWith(".html"))) {
        const source = readFileSync(join(here, "static", file), "utf8");
        if (!source.includes("<!-- modulepreload -->")) continue;
        const html = source
          .replace("<!-- theme -->", () => `<script>${skeletons.themeBootScript()}</script>`)
          .replace("<!-- modulepreload -->", () => preload)
          .replace(/<!-- skeleton:(\w+) -->/, (_, name) => {
            if (!byName[name]) throw new Error(`static/${file}: no skeleton named ${name} in src/skeletons.ts`);
            return byName[name]();
          });
        writeFileSync(join(dist, file), html);
      }
    });
  },
};

/** src/skeletons.ts as a module this build can call (it has no imports, so it is one small bundle). */
async function loadSkeletons() {
  const { outputFiles } = await esbuild.build({ entryPoints: [join(here, "src", "skeletons.ts")], bundle: true, format: "esm", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}

/**
 * The chunks review.js needs before its first render: its static imports, the chunks it imports dynamically at
 * startup (host adapter, page, preferences) and their static imports. What those load later themselves (the diff
 * renderer, the analysis engine, the local dev host) is left out.
 */
function startupChunks(metafile) {
  const outputs = metafile.outputs;
  const entry = Object.keys(outputs).find((path) => /[\\/]index\.ts$/.test(outputs[path].entryPoint ?? ""));
  if (!entry) return [];
  const files = new Set();
  const visit = (path, dynamicToo) => {
    for (const imp of outputs[path]?.imports ?? []) {
      if (imp.external || files.has(imp.path)) continue;
      if (imp.kind === "import-statement" || (dynamicToo && imp.kind === "dynamic-import")) {
        files.add(imp.path);
        visit(imp.path, false);
      }
    }
  };
  visit(entry, true);
  return [...files].map((path) => basename(path));
}

const options = {
  entryPoints: {
    review: join(here, "src", "index.ts"),
    action: join(here, "src", "action.ts"),
    // Loaded by src/review/engine.ts as new URL("./review-worker.js", import.meta.url).
    "review-worker": join(here, "src", "review", "worker.ts"),
  },
  outdir: dist,
  bundle: true,
  format: "esm",
  splitting: true,
  target: "es2022",
  platform: "browser",
  metafile: true,
  plugins: [
    {
      name: "pierre-local-highlighter",
      setup(build) {
        build.onResolve({ filter: /^shiki$/ }, () => ({ path: join(here, "src/ui/pierre/shiki.ts") }));
      },
    },
    startupHtml,
  ],
  sourcemap: serve ? "inline" : "linked",
  minify: !serve,
  loader: { ".woff": "file", ".woff2": "file", ".ttf": "file", ".svg": "file", ".png": "file" },
  // web-tree-sitter's Node code paths are never taken in the browser.
  external: ["fs", "fs/promises", "module", "path", "url"],
  define: {
    "process.env.NODE_ENV": serve ? '"development"' : '"production"',
  },
  logLevel: "info",
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  // Serve the extension root so dist/, assets/ and dev-data/ keep the same relative layout as the .vsix.
  const { port } = await ctx.serve({ servedir: here, host: "127.0.0.1", port: Number(process.env.PORT) || 5173 });
  console.log(`\n  Azure DevOps-like shell: http://127.0.0.1:${port}/dev/\n  Page only:              http://127.0.0.1:${port}/dist/review.html\n`);
} else {
  await esbuild.build(options);
}
