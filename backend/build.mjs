// Builds the backend function's deployment folder, backend/.build/app, which infra/ zips and deploys.
//   node backend/build.mjs
// The folder holds one bundled script, the Windows x64 ONNX runtime, and the quantized model, so the
// function needs no npm install and downloads nothing at runtime.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(here, ".build", "app");

const MODEL = "Xenova/all-MiniLM-L6-v2";
const MODEL_FILES = ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"];
/** The Function App runs 64-bit Windows (infra/main.tf); the other platforms' binaries are ~220 MB. */
const ORT_PLATFORM = join("bin", "napi-v6", "win32", "x64");

// .build is generated output inside backend/, never a source directory.
if (dirname(dirname(out)) !== here) throw new Error("Unexpected build output directory");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await esbuild.build({
  entryPoints: [join(here, "src", "index.ts")],
  outfile: join(out, "dist", "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  minify: true,
  // Native runtime, copied below; the Functions worker provides @azure/functions-core.
  external: ["onnxruntime-node", "onnxruntime-common", "@azure/functions-core"],
  // transformers.js imports sharp for image models only; text embeddings never call it.
  alias: { sharp: join(here, "src", "sharp-stub.ts") },
  // Bundled CommonJS (@azure/functions) calls require() for the externals.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "info",
});

// onnxruntime-node and its one runtime dependency, with only this platform's binaries.
const ortNode = packageDir("onnxruntime-node", import.meta.url);
const ortCommon = packageDir("onnxruntime-common", join(ortNode, "package.json"));
const modules = join(out, "node_modules");
cpSync(ortNode, join(modules, "onnxruntime-node"), {
  recursive: true,
  filter: (src) => {
    const rel = relative(ortNode, src);
    return !rel.startsWith("bin") || ORT_PLATFORM.startsWith(rel) || rel.startsWith(ORT_PLATFORM);
  },
});
cpSync(ortCommon, join(modules, "onnxruntime-common"), { recursive: true });

// The model, downloaded once into the CLI's cache (.cache/models) and copied into the package.
const cache = join(root, ".cache", "models");
const { env, pipeline } = await import("@huggingface/transformers");
env.cacheDir = cache;
await (await pipeline("feature-extraction", MODEL, { dtype: "q8" })).dispose();
for (const file of MODEL_FILES) {
  const target = join(out, "models", MODEL, file);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(cache, MODEL, file), target);
}

writeFileSync(join(out, "package.json"), `${JSON.stringify({ name: "review-deck-embed", type: "module", main: "dist/index.mjs" }, null, 2)}\n`);
cpSync(join(here, "host.json"), join(out, "host.json"));

// Content hash, so Terraform redeploys exactly when the package changes.
const hash = createHash("sha256");
for (const file of walk(out).sort()) hash.update(relative(out, file)).update(readFileSync(file));
writeFileSync(join(here, ".build", "version"), hash.digest("hex").slice(0, 16));
console.log(`built ${relative(root, out)} (${Math.round(walk(out).reduce((n, f) => n + statSync(f).size, 0) / 1e6)} MB)`);

/** Folder of an installed package, as resolved from `from` (their exports maps hide package.json). */
function packageDir(name, from) {
  let dir = dirname(createRequire(from).resolve(name));
  while (!existsSync(join(dir, "package.json")) || JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name !== name) {
    if (dirname(dir) === dir) throw new Error(`Cannot find the ${name} package folder`);
    dir = dirname(dir);
  }
  return dir;
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}
