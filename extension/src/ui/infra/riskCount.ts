import { isInfrastructure } from "../../../../src/infra/blocks";
import type { InfraModule } from "../../../../src/infra/types";

/** For the tab's badge: the resources that may be destroyed or replaced. */
export function riskCount(modules: InfraModule[]): number {
  return modules.flatMap((m) => m.blocks).filter((b) => isInfrastructure(b) && (b.risk?.kind === "destroy" || b.risk?.kind === "replace")).length;
}
