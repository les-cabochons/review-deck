// The Infra view's map of modules: which folders the pull request changes, which modules they call, and the values
// that pass between them. Built from the module blocks and references the diff already holds (lib/diff.ts), so it
// knows only what the changed files say.
import type { InfraEdge, InfraModule } from "./types.js";

export interface ModuleNode {
  /** The folder's repository path ("" for the root), `remote:<source>`, or `call:<caller>:<name>` when unresolved. */
  id: string;
  /** `modules/storage`, `Azure/naming/azurerm`, or `module.network` when its source isn't known. */
  label: string;
  /**
   * `changed`: a folder with changed Terraform files. `neighbour`: a folder of the repository the PR doesn't change.
   * `remote`: a registry or git module, never read. `unknown`: a call declared in a file the PR doesn't change.
   */
  kind: "changed" | "neighbour" | "remote" | "unknown";
  /** Its changes, when `changed`. */
  module: InfraModule | null;
}

/** `to` uses what `from` gives: a module output, or the module itself when its caller only calls it. */
export interface ModuleLink {
  from: string;
  to: string;
  /** The outputs passed, the ones the change touches first. Empty when `to` calls `from` without reading an output. */
  names: string[];
  /** Over every reference behind the link: `same` when none changed, otherwise what the change did to them. */
  status: InfraEdge["status"];
}

/** `caller` has a module block (`module.<name>`) whose source is `callee`. */
export interface ModuleCall {
  caller: string;
  callee: string;
  name: string;
}

export interface ModuleMap {
  /** Changed folders first, in path order, then the modules they call. */
  nodes: ModuleNode[];
  links: ModuleLink[];
  calls: ModuleCall[];
}

/** Where a module block's source points, from the folder that calls it. */
function resolve(caller: string, source: string | undefined, name: string): { id: string; label: string; kind: ModuleNode["kind"] } {
  if (source === undefined) return { id: `call:${caller}:${name}`, label: `module.${name}`, kind: "unknown" };
  if (!source.startsWith("./") && !source.startsWith("../")) return { id: `remote:${source}`, label: source, kind: "remote" };
  const parts = caller ? caller.split("/") : [];
  for (const part of source.split("/")) {
    if (part === "" || part === ".") continue;
    if (part !== "..") parts.push(part);
    // A path that climbs out of the repository can't be read: shown as written.
    else if (parts.pop() === undefined) return { id: `remote:${source}`, label: source, kind: "remote" };
  }
  const dir = parts.join("/");
  return { id: dir, label: dir || "Repository root", kind: "neighbour" };
}

/** A chain of references: whether all of them exist before the change, after it, and whether one was touched. */
interface Path {
  base: boolean;
  head: boolean;
  touched: boolean;
}
const along = (path: Path, status: InfraEdge["status"]): Path => ({
  base: path.base && status !== "added",
  head: path.head && status !== "removed",
  touched: path.touched || status === "touched",
});
const statusOf = (path: Path): InfraEdge["status"] => (path.base && path.head ? (path.touched ? "touched" : "same") : path.head ? "added" : "removed");

/** Two references to one pair, merged: unchanged only if both are, otherwise what they share, or `touched`. */
const merge = (a: InfraEdge["status"], b: InfraEdge["status"]): InfraEdge["status"] => (a === b ? a : a === "same" ? b : b === "same" ? a : "touched");

/**
 * The map of the modules `modules` (one per changed folder, from TerraformReader.diff) change and call. A link goes
 * from a module to the module that reads one of its outputs, through the folder that calls them both and any locals
 * there, or to that folder itself when it reads the output, or only calls the module.
 */
export function moduleMap(modules: InfraModule[]): ModuleMap {
  const nodes = new Map<string, ModuleNode>();
  for (const module of modules) nodes.set(module.dir, { id: module.dir, label: module.dir || "Repository root", kind: "changed", module });
  const links = new Map<string, ModuleLink>();
  const link = (from: string, to: string, names: string[], status: InfraEdge["status"]) => {
    if (from === to) return;
    const key = `${from}\u0000${to}`;
    const known = links.get(key);
    if (!known) links.set(key, { from, to, names: [...names], status });
    else {
      known.names = [...new Set(status === "same" ? [...known.names, ...names] : [...names, ...known.names])];
      known.status = merge(known.status, status);
    }
  };
  const calls: ModuleCall[] = [];

  for (const module of modules) {
    const target = new Map<string, string>();
    for (const block of module.blocks) {
      if (block.kind !== "module") continue;
      const where = resolve(module.dir, block.source, block.name);
      if (!nodes.has(where.id)) nodes.set(where.id, { ...where, module: null });
      target.set(block.address, where.id);
      calls.push({ caller: module.dir, callee: where.id, name: block.name });
    }
    // What reads each block here, to follow an output through locals (`local.id = module.storage.id`).
    const readers = new Map<string, InfraEdge[]>();
    for (const edge of module.edges) (readers.get(edge.from) ?? readers.set(edge.from, []).get(edge.from)!).push(edge);
    /**
     * Where a value read by `address` ends up: the modules that read it, through any locals, or else this folder.
     * `path` says on which sides every reference on the way exists: a path that mixes a removed reference with an
     * added one never existed, and leads nowhere. `seen` is the path's own locals, against a cycle.
     */
    const destinations = (address: string, path: Path, seen: ReadonlySet<string>): { to: string; status: InfraEdge["status"] }[] => {
      if (!address.startsWith("local.")) return [{ to: target.get(address) ?? module.dir, status: statusOf(path) }];
      if (seen.has(address)) return [];
      const next = (readers.get(address) ?? []).flatMap((edge) => {
        const further = along(path, edge.status);
        return further.base || further.head ? destinations(edge.to, further, new Set(seen).add(address)) : [];
      });
      // A local nothing here reads is used in a file the PR doesn't change, or nowhere: it stays in this folder.
      return next.length > 0 ? next : [{ to: module.dir, status: statusOf(path) }];
    };
    const linked = new Set<string>();
    for (const edge of module.edges) {
      const from = target.get(edge.from);
      if (from === undefined) continue;
      const start = along({ base: true, head: true, touched: false }, edge.status);
      for (const end of destinations(edge.to, start, new Set())) link(from, end.to, edge.outputs ?? [], end.status);
      linked.add(edge.from);
    }
    // A module whose outputs nothing here reads still hangs off the folder that calls it.
    for (const block of module.blocks) {
      if (block.kind !== "module" || linked.has(block.address)) continue;
      link(target.get(block.address)!, module.dir, [], block.status === "added" ? "added" : block.status === "removed" ? "removed" : "same");
    }
  }

  const order = (n: ModuleNode) => (n.kind === "changed" ? 0 : 1);
  return {
    nodes: [...nodes.values()].sort((a, b) => order(a) - order(b) || a.label.localeCompare(b.label)),
    links: [...links.values()],
    calls,
  };
}

/** The map is worth drawing when the pull request changes more than one folder; with one, its resource diagram says it all. */
export const showsModuleMap = (modules: InfraModule[]) => modules.length > 1;
