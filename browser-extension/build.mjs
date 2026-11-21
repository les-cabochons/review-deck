// Builds the browser extension into browser-extension/dist: one folder for Chrome and Firefox, loaded unpacked as is.
//   node browser-extension/build.mjs
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");

rmSync(dist, { recursive: true, force: true });
cpSync(join(here, "static"), dist, { recursive: true });
cpSync(join(here, "..", "extension", "images", "logo.png"), join(dist, "logo.png"));

await esbuild.build({
  entryPoints: [join(here, "src", "background.ts"), join(here, "src", "options.ts")],
  outdir: dist,
  bundle: true,
  format: "iife",
  target: ["chrome120", "firefox128"],
  logLevel: "warning",
});
console.log(`Built ${dist}`);
