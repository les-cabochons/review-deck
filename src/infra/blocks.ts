// Small readings of an InfraBlock that the page needs without loading the parser (terraform.ts) or the layout
// (diagram.ts): what counts as changed, how risky a block is, how to name it.
import type { InfraBlock, InfraEdge, InfraModule, InfraSummary } from "./types.js";

/** Drawn as a box: what Terraform creates, reads or calls. Variables, locals and outputs are the wiring between them. */
export const isInfrastructure = (block: InfraBlock) => block.kind === "resource" || block.kind === "data" || block.kind === "module";

/** The code of the block changed, beyond its description. */
export const isChanged = (block: InfraBlock) => block.status !== "same" && !block.docsOnly;

/** Worth a reviewer's look: changed, or unchanged in the code but at risk because of what it uses. */
export const needsLook = (block: InfraBlock) => isChanged(block) || block.risk !== null;

/**
 * The status of a connector drawn for both directions of a pair, as the diagrams' layout merges them: theirs when
 * they agree, `touched` when they don't (a pull request that reverses a dependency removes one and adds the other).
 */
export function pairStatus(a: InfraEdge["status"] | undefined, b: InfraEdge["status"] | undefined): InfraEdge["status"] | undefined {
  if (!a || !b) return a ?? b;
  return a === b ? a : "touched";
}

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

/** `azurerm_windows_function_app` reads as "Windows function app": the provider prefix says little to a reviewer. */
function typeTitle(type: string): string {
  const words = type.split("_").slice(1).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A block's name for a reader, and its address as a second line when the name isn't the address already. */
export function blockTitle(block: InfraBlock): { title: string; subtitle: string | null } {
  if (block.kind === "resource" && block.type) return { title: typeTitle(block.type), subtitle: block.address };
  if (block.kind === "data" && block.type) return { title: `${typeTitle(block.type)} (data)`, subtitle: block.address };
  if (block.kind === "module") return { title: `Module ${block.name}`, subtitle: block.address };
  return { title: block.address, subtitle: null };
}
