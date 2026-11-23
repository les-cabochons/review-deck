import type { AttributeChange, InfraBlock, InfraEdge, InfraModule } from "../types.js";
import type { ParsedBlock, ParsedFile } from "./hcl.js";

/** One changed file of a directory, parsed on both sides. `null`: absent on that side. */
export interface ModuleFile {
  path: string;
  base: ParsedFile | null;
  head: ParsedFile | null;
}

/** A block as parsed on each side, for the rules that need more than its changes (lib/risk.ts). */
export interface BlockSides {
  base?: ParsedBlock;
  head?: ParsedBlock;
}

export interface ModuleDiff {
  module: InfraModule;
  sides: Map<string, BlockSides>;
}

/**
 * Diffs the blocks of one directory by address. The address is the same on both sides whatever moved around it,
 * so the diff is exact: a block is added, removed, or changed in the attributes listed.
 */
export function diffModule(dir: string, files: ModuleFile[]): ModuleDiff {
  const sides = new Map<string, BlockSides>();
  const side = (address: string) => {
    let entry = sides.get(address);
    if (!entry) sides.set(address, (entry = {}));
    return entry;
  };
  for (const file of files) {
    for (const block of file.base?.blocks ?? []) side(block.address).base = block;
    for (const block of file.head?.blocks ?? []) side(block.address).head = block;
  }

  const blocks = new Map<string, InfraBlock>();
  for (const [address, { base, head }] of sides) {
    const changes = attributeChanges(base?.attributes, head?.attributes);
    const shown = head ?? base!;
    const status = !base ? "added" : !head ? "removed" : changes.length > 0 ? "changed" : "same";
    blocks.set(address, {
      address,
      kind: shown.kind,
      type: shown.type,
      name: shown.name,
      file: shown.file,
      line: shown.line,
      status,
      docsOnly: status === "changed" && changes.every((c) => c.path === "description"),
      changes,
      risk: null,
      notes: [],
      ...(shown.kind === "module" && shown.attributes.has("source") ? { source: unquote(shown.attributes.get("source")!) } : {}),
    });
  }

  // A resource, data source or module that is referenced but declared in a file the pull request doesn't change:
  // known by its address alone, and drawn as an unchanged neighbour.
  for (const { base, head } of [...sides.values()]) {
    for (const parsed of [base, head]) {
      for (const reference of parsed?.references.keys() ?? []) {
        if (blocks.has(reference) || reference.startsWith("var.") || reference.startsWith("local.")) continue;
        blocks.set(reference, outsideBlock(reference));
      }
    }
  }

  return {
    module: {
      dir,
      files: files.map((f) => f.path),
      blocks: [...blocks.values()],
      edges: edgesOf(sides, blocks),
      parseErrors: files.filter((f) => f.base?.hasError || f.head?.hasError).map((f) => f.path),
    },
    sides,
  };
}

function outsideBlock(address: string): InfraBlock {
  const parts = address.split(".");
  const [kind, type, name] =
    parts[0] === "data" ? (["data", parts[1], parts[2]] as const) : parts[0] === "module" ? (["module", null, parts[1]] as const) : (["resource", parts[0], parts[1]] as const);
  return { address, kind, type, name, file: null, line: null, status: "same", docsOnly: false, changes: [], risk: null, notes: [] };
}

export function attributeChanges(before: Map<string, string> | undefined, after: Map<string, string> | undefined): AttributeChange[] {
  const changes: AttributeChange[] = [];
  for (const path of new Set([...(before?.keys() ?? []), ...(after?.keys() ?? [])])) {
    const b = before?.get(path) ?? null;
    const a = after?.get(path) ?? null;
    if (b !== a) changes.push({ path, before: b, after: a });
  }
  return changes.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
}

/** True when `path` is one of `changed`, holds one, or is held by one (`tags` and `tags.env`). */
const overlaps = (path: string, changed: string[]) => changed.some((c) => c === path || c.startsWith(`${path}.`) || path.startsWith(`${c}.`));

function edgesOf(sides: Map<string, BlockSides>, blocks: Map<string, InfraBlock>): InfraEdge[] {
  const edges: InfraEdge[] = [];
  for (const [to, { base, head }] of sides) {
    const references = new Set([...(base?.references.keys() ?? []), ...(head?.references.keys() ?? [])]);
    for (const from of references) {
      if (from === to || !blocks.has(from)) continue;
      const before = base?.references.get(from);
      const after = head?.references.get(from);
      const via = [...(after ?? before)!].sort();
      // A removed reference is only in the base side's text.
      const block = (after ? head : base)!;
      const module = from.startsWith("module.");
      if (!before || !after) {
        edges.push({ from, to, status: after ? "added" : "removed", via, ...(module ? { outputs: outputsRead(from, block, via) } : {}) });
        continue;
      }
      const changed = blocks.get(to)!.changes.map((c) => c.path);
      const touched = [...new Set([...before, ...after])].filter((path) => overlaps(path, changed)).sort();
      // The outputs a changed line reads, on either side, come first: they are what a label too short for all of them shows.
      const outputs = module ? { outputs: [...new Set([...outputsRead(from, head!, touched), ...outputsRead(from, base!, touched), ...outputsRead(from, block, via)])] } : {};
      edges.push(touched.length > 0 ? { from, to, status: "touched", via: touched, ...outputs } : { from, to, status: "same", via, ...outputs });
    }
  }
  return edges;
}

/** The outputs of `module` (`module.storage`) that the attributes `via` of `block` read, from their text. */
function outputsRead(module: string, block: ParsedBlock, via: string[]): string[] {
  const pattern = new RegExp(`\\b${module.replace(".", "\\.")}(?:\\[[^\\]]*\\])?\\.([A-Za-z_][\\w-]*)`, "g");
  const found = new Set<string>();
  for (const path of via) for (const match of (block.attributes.get(path) ?? "").matchAll(pattern)) found.add(match[1]);
  return [...found].sort();
}

/** `"./modules/storage"` reads as `./modules/storage`. A source built from an expression stays as written. */
const unquote = (text: string) => (/^"[^"$]*"$/.test(text) ? text.slice(1, -1) : text);
