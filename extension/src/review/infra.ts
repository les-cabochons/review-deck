// The Infra view's data: what the comparison changes in Terraform, read from the files the review already holds.
// The parser, its grammar and the list of arguments that force a new resource load only for a pull request that
// touches Terraform.
import { summarize } from "../../../src/infra/blocks";
import { isTerraformPath, TERRAFORM_GRAMMAR } from "../../../src/infra/grammar";
import type { InfraModule, TerraformFile } from "../../../src/infra/types";
import type { FileChange } from "../data/model";
import type { FileContents } from "./analysis";

export interface InfraReading {
  /** One per directory with changed Terraform files. */
  modules: InfraModule[];
  /** The provider documentation the "replace" readings rest on (`azurerm 5.14.0`). */
  replaceSources: readonly { provider: string; version: string }[];
  /** Resources and modules that may be destroyed or replaced. */
  riskCount: number;
  /** Terraform files left out because they are binary or too large to diff. */
  skipped: string[];
}

type Reader = import("../../../src/infra/terraform").TerraformReader;
let reader: Promise<Reader> | null = null;

/** One parser for the page, created on first use. The .wasm files sit in ../assets, beside the review's grammars. */
function terraformReader(): Promise<Reader> {
  const asset = (name: string) => new URL(name, new URL("../assets/", document.baseURI)).toString();
  reader ??= import("../../../src/infra/terraform").then(({ TerraformReader }) =>
    TerraformReader.create(asset(TERRAFORM_GRAMMAR.file), { locateFile: (file: string) => asset(file) }),
  );
  // A failed load (offline, a blocked .wasm) is tried again on the next read.
  reader.catch(() => (reader = null));
  return reader;
}

/**
 * Reads the Terraform changes of a comparison. Runs on the page: parsing a pull request's .tf files takes a few
 * milliseconds, far below what the grouping needs a worker for.
 */
export async function readInfra(changes: FileChange[], contents: Map<string, FileContents>): Promise<InfraReading> {
  const files: TerraformFile[] = [];
  const skipped: string[] = [];
  for (const change of changes) {
    if (!isTerraformPath(change.path) && !(change.originalPath && isTerraformPath(change.originalPath))) continue;
    const content = contents.get(change.path);
    if (!content || content.binary || content.tooLarge) skipped.push(change.path);
    else files.push({ path: change.path, oldPath: change.originalPath, old: content.old, new: content.new });
  }
  const [terraform, { REPLACE_SOURCES }] = await Promise.all([terraformReader(), import("../../../src/infra/terraform")]);
  const modules = terraform.diff(files);
  const { destroy, replace } = summarize(modules);
  return { modules, riskCount: destroy + replace, replaceSources: REPLACE_SOURCES, skipped };
}
