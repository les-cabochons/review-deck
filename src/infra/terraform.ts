import { Language, Parser } from "web-tree-sitter";
import { isTerraformPath } from "./grammar.js";
import { diffModule, type ModuleFile } from "./lib/diff.js";
import { parseTerraform } from "./lib/hcl.js";
import { assessRisks, FORCE_NEW_SOURCES } from "./lib/risk.js";
import type { InfraBlock, InfraModule, InfraSummary, TerraformFile } from "./types.js";

export type WasmSource = string | URL | Uint8Array;

/** The provider documentation the "replace" readings rest on, for the page to name: `azurerm 5.14.0`. */
export const REPLACE_SOURCES: readonly { provider: string; version: string }[] = FORCE_NEW_SOURCES;

/**
 * Reads what a pull request changes in Terraform (or OpenTofu) from the text of its changed files: which blocks
 * are added, removed or changed, what uses what, and what may be destroyed or replaced. It never runs
 * `terraform`, and knows nothing of the state or of what the provider will do, so it says what the code changes,
 * not what the cloud will. Each `Risk` carries how far it can be trusted.
 */
export class TerraformReader {
  private constructor(private readonly parser: Parser) {}

  /** `wasm` is the grammar (TERRAFORM_GRAMMAR): a file path in Node, a URL in the browser. `init` goes to web-tree-sitter. */
  static async create(wasm: WasmSource, init?: Parameters<typeof Parser.init>[0]): Promise<TerraformReader> {
    await Parser.init(init);
    const parser = new Parser();
    parser.setLanguage(await Language.load(wasm));
    return new TerraformReader(parser);
  }

  /**
   * One module per directory with changed Terraform files, in path order. Files that aren't Terraform are skipped.
   * Only the files given are read. A block they reference but don't declare shows as an unchanged neighbour
   * (`file: null`), and what an unchanged file does with a changed block isn't seen.
   */
  diff(files: TerraformFile[]): InfraModule[] {
    const byDir = new Map<string, ModuleFile[]>();
    for (const file of files) {
      if (!isTerraformPath(file.path)) continue;
      const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
      let group = byDir.get(dir);
      if (!group) byDir.set(dir, (group = []));
      group.push({
        path: file.path,
        base: file.old === null ? null : parseTerraform(this.parser, file.path, file.old),
        head: file.new === null ? null : parseTerraform(this.parser, file.path, file.new),
      });
    }
    return [...byDir.keys()].sort().map((dir) => assessRisks(diffModule(dir, byDir.get(dir)!)));
  }
}

/** Drawn as a box: what Terraform creates, reads or calls. Variables, locals and outputs are the wiring between them. */
export const isInfrastructure = (block: InfraBlock) => block.kind === "resource" || block.kind === "data" || block.kind === "module";

/** The code of the block changed, beyond its description. */
export const isChanged = (block: InfraBlock) => block.status !== "same" && !block.docsOnly;

/** Worth a reviewer's look: changed, or unchanged in the code but at risk because of what it uses. */
export const needsLook = (block: InfraBlock) => isChanged(block) || block.risk !== null;

/** Riskiest first: destroy, replace (likely, then possible), follows, changed, added, removed without a risk, description only. */
export function riskRank(block: InfraBlock): number {
  if (block.risk?.kind === "destroy") return 0;
  if (block.risk?.kind === "replace") return block.risk.certainty === "likely" ? 1 : 2;
  if (block.risk?.kind === "follows") return 3;
  if (block.docsOnly) return 8;
  return { changed: 4, added: 5, removed: 6, same: 7 }[block.status];
}

/** Counts resources, data sources and modules, each once, by the worst that may happen to it. */
export function summarize(modules: InfraModule[]): InfraSummary {
  const summary: InfraSummary = { destroy: 0, replace: 0, follows: 0, changed: 0, added: 0 };
  for (const block of modules.flatMap((m) => m.blocks)) {
    if (!isInfrastructure(block) || !needsLook(block)) continue;
    if (block.risk) summary[block.risk.kind]++;
    else if (block.status === "changed") summary.changed++;
    else if (block.status === "added") summary.added++;
  }
  return summary;
}
