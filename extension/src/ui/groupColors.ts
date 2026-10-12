import type { Group } from "../../../src/core/types";
export const GROUP_COLORS = ["#0078d4", "#d97706", "#059669", "#db2777", "#7c3aed", "#0891b2", "#65a30d", "#dc2626"];
export function groupColor(groups: Group[], group: Group): string {
  return group.kind === "semantic" ? GROUP_COLORS[groups.filter(item => item.kind === "semantic").indexOf(group) % GROUP_COLORS.length] : "#8a8886";
}
