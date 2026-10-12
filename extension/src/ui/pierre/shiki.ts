// Fine-grained browser bundle used by Pierre. Grammar chunks are packaged locally.
import { createBundledHighlighter, createSingletonShorthands } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
export * from "shiki/core";
export { createJavaScriptRegexEngine } from "shiki/engine/javascript";
export { createOnigurumaEngine } from "shiki/engine/oniguruma";

const typescript = () => import("@shikijs/langs/typescript");
const javascript = () => import("@shikijs/langs/javascript");
export const bundledLanguages = {
  typescript, ts: typescript, javascript, js: javascript,
  tsx: () => import("@shikijs/langs/tsx"),
  jsx: () => import("@shikijs/langs/jsx"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  markdown: () => import("@shikijs/langs/markdown"),
  css: () => import("@shikijs/langs/css"),
  html: () => import("@shikijs/langs/html"),
  yaml: () => import("@shikijs/langs/yaml"),
  bash: () => import("@shikijs/langs/bash"),
};
export const bundledThemes = {};
export const createHighlighter = createBundledHighlighter({
  langs: bundledLanguages, themes: bundledThemes, engine: () => createJavaScriptRegexEngine(),
});
export const { codeToHtml } = createSingletonShorthands(createHighlighter);
