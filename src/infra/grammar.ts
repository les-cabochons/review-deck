// The tree-sitter grammar the Infra view parses Terraform with, and the npm package shipping its .wasm.
// Plain data with no imports, like src/parse/grammars.ts: extension/build.mjs imports this file directly to
// copy the grammar into the extension.

export const TERRAFORM_GRAMMAR = { package: "@tree-sitter-grammars/tree-sitter-hcl", file: "tree-sitter-hcl.wasm" } as const;

/** Terraform and OpenTofu configuration files. `.tf.json` is JSON, which this grammar doesn't read. */
export function isTerraformPath(path: string): boolean {
  return /\.(tf|tofu)$/i.test(path);
}
