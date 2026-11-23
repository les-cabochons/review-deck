// What the Infra view's diagram of a module shows. Where it goes is the relations map's layout (src/relations/diagram.ts):
// columns from left to right, what is used before what uses it.
import { isChanged, isInfrastructure } from "./blocks.js";
import type { InfraBlock, InfraEdge, InfraModule } from "./types.js";

const isWiring = (block: InfraBlock) => block.kind === "variable" || block.kind === "local" || block.kind === "output";

/**
 * What the diagram draws: every changed resource, data source and module, plus what the change involves around
 * them. That is what a changed block uses through a changed line, what uses a changed block, and the changed
 * variables, locals and outputs wired to one of them. A changed variable with nothing drawn around it is left to
 * the list.
 */
export function diagramContent(module: InfraModule): { blocks: InfraBlock[]; edges: InfraEdge[] } {
  const byAddress = new Map(module.blocks.map((b) => [b.address, b]));
  const picked = new Set<string>();
  for (const block of module.blocks) if (isChanged(block) && (isInfrastructure(block) || isWiring(block))) picked.add(block.address);
  const drawable = (block: InfraBlock) => isInfrastructure(block) || (isWiring(block) && isChanged(block));
  for (const edge of module.edges) {
    const from = byAddress.get(edge.from)!;
    const to = byAddress.get(edge.to)!;
    // An unchanged reference of a changed block says nothing about the change, so its target stays out.
    if (isChanged(to) && drawable(from) && (to.status !== "changed" || edge.status !== "same")) picked.add(from.address);
    if (isChanged(from) && isInfrastructure(to)) picked.add(to.address);
  }
  const edges = module.edges.filter((e) => picked.has(e.from) && picked.has(e.to));
  for (const address of [...picked]) {
    if (isWiring(byAddress.get(address)!) && !edges.some((e) => e.from === address || e.to === address)) picked.delete(address);
  }
  return { blocks: [...picked].map((a) => byAddress.get(a)!), edges: edges.filter((e) => picked.has(e.from) && picked.has(e.to)) };
}

/** `app_settings.API_KEY` reads as `API_KEY` next to a connector: the map's name adds nothing there. */
export const edgeName = (path: string) => path.replace(/^app_settings\./, "");
