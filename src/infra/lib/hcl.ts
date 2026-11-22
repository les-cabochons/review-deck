import type { Node, Parser } from "web-tree-sitter";
import type { BlockKind } from "../types.js";

/** One addressable block of a Terraform file, on one side of the comparison. */
export interface ParsedBlock {
  address: string;
  kind: BlockKind;
  type: string | null;
  name: string;
  file: string;
  /** 1-based. */
  line: number;
  /** Flattened `path -> expression text` (see `flattenBody`). */
  attributes: Map<string, string>;
  /** `address referenced -> the attribute paths that reference it`. */
  references: Map<string, Set<string>>;
}

export interface ParsedFile {
  blocks: ParsedBlock[];
  /** The grammar hit a syntax error: some blocks may be missing or wrong. */
  hasError: boolean;
}

/** Roots of a traversal that aren't something declared in the configuration. */
const BUILTIN_ROOTS = new Set(["path", "count", "each", "self", "terraform"]);

/** A resource type always has its provider's prefix: `azurerm_storage_account`, `random_string`. */
const RESOURCE_TYPE = /^[a-z0-9]+_[a-z0-9_]+$/;

/** Object literals deeper than this are kept as one value. */
const MAX_OBJECT_DEPTH = 3;

export function parseTerraform(parser: Parser, file: string, source: string): ParsedFile {
  const tree = parser.parse(source);
  if (!tree) return { blocks: [], hasError: true };
  try {
    const body = tree.rootNode.namedChildren.find((c) => c?.type === "body");
    const blocks: ParsedBlock[] = [];
    for (const block of childrenOf(body, "block")) blocks.push(...blocksOf(block, file, source));
    return { blocks, hasError: tree.rootNode.hasError };
  } finally {
    tree.delete();
  }
}

function childrenOf(node: Node | null | undefined, type: string): Node[] {
  return node ? node.namedChildren.filter((c): c is Node => c?.type === type) : [];
}

const named = (node: Node): Node[] => node.namedChildren.filter((c): c is Node => c !== null);

/** A label's text without its quotes: block labels are `"azurerm_x"` or a bare identifier. */
const unquote = (text: string) => text.replace(/^"(.*)"$/s, "$1");

function blocksOf(block: Node, file: string, source: string): ParsedBlock[] {
  const children = named(block);
  const kind = children[0]?.text;
  const labels = children.slice(1).filter((c) => c.type === "string_lit" || c.type === "identifier").map((c) => unquote(c.text));
  const body = children.find((c) => c.type === "body");
  const line = block.startPosition.row + 1;

  const make = (address: string, blockKind: BlockKind, name: string, type: string | null = null): ParsedBlock => {
    const parsed: ParsedBlock = { address, kind: blockKind, type, name, file, line, attributes: new Map(), references: new Map() };
    if (body) flattenBody(body, "", parsed, source, []);
    return parsed;
  };

  switch (kind) {
    case "resource":
      return labels.length >= 2 ? [make(`${labels[0]}.${labels[1]}`, "resource", labels[1], labels[0])] : [];
    case "data":
      return labels.length >= 2 ? [make(`data.${labels[0]}.${labels[1]}`, "data", labels[1], labels[0])] : [];
    case "module":
      return labels[0] ? [make(`module.${labels[0]}`, "module", labels[0])] : [];
    case "variable":
      return labels[0] ? [make(`var.${labels[0]}`, "variable", labels[0])] : [];
    case "output":
      return labels[0] ? [make(`output.${labels[0]}`, "output", labels[0])] : [];
    case "provider":
      return labels[0] ? [make(`provider.${labels[0]}${aliasOf(body)}`, "provider", labels[0])] : [];
    case "check":
      return labels[0] ? [make(`check.${labels[0]}`, "check", labels[0])] : [];
    case "terraform":
      return [make("terraform", "terraform", "terraform")];
    case "moved":
    case "removed":
    case "import": {
      // These have no name. Their `from`/`to` say what they are about, and that makes them one block across sides.
      const parsed = make(kind, kind, kind);
      const subject = parsed.attributes.get("from") ?? parsed.attributes.get("to") ?? String(line);
      parsed.address = `${kind}:${subject}${kind === "moved" ? `->${parsed.attributes.get("to") ?? ""}` : ""}`;
      return [parsed];
    }
    case "locals": {
      // Each local is addressed on its own (`local.name`), so one changed local is one change.
      const locals: ParsedBlock[] = [];
      for (const attribute of childrenOf(body, "attribute")) {
        const [nameNode, expression] = named(attribute);
        if (!nameNode || !expression) continue;
        const parsed: ParsedBlock = {
          address: `local.${nameNode.text}`,
          kind: "local",
          type: null,
          name: nameNode.text,
          file,
          line: attribute.startPosition.row + 1,
          attributes: new Map(),
          references: new Map(),
        };
        flattenValue(expression, "value", parsed, source, [], 0);
        locals.push(parsed);
      }
      return locals;
    }
    default:
      return [];
  }
}

/** `.alias` of a provider block with one, so two configurations of a provider stay two blocks. */
function aliasOf(body: Node | undefined): string {
  for (const attribute of childrenOf(body, "attribute")) {
    const [name, expression] = named(attribute);
    if (name?.text === "alias" && expression) return `.${unquote(expression.text.trim())}`;
  }
  return "";
}

/**
 * Flattens a block body into `block.attributes` and `block.references`.
 * - A nested block's attributes get its name as a prefix: `site_config.application_stack.node_version`.
 * - Repeated nested blocks get an index: `notification[1].threshold`.
 * - An object literal is flattened per key, so one added app setting is one change: `app_settings.API_KEY`.
 * - A `dynamic "x"` block reads as the block `x` it generates.
 * `bound` holds the names the enclosing `dynamic` blocks bind, which are not references to resources.
 */
function flattenBody(body: Node, prefix: string, block: ParsedBlock, source: string, bound: string[]): void {
  const nested = childrenOf(body, "block");
  const nameOf = (b: Node) => {
    const [type, label] = named(b);
    return type?.text === "dynamic" && label ? unquote(label.text) : (type?.text ?? "");
  };
  const total = new Map<string, number>();
  for (const b of nested) total.set(nameOf(b), (total.get(nameOf(b)) ?? 0) + 1);
  const seen = new Map<string, number>();

  for (const child of named(body)) {
    if (child.type === "attribute") {
      const [name, expression] = named(child);
      if (name && expression) flattenValue(expression, prefix + name.text, block, source, bound, 0);
    } else if (child.type === "block") {
      const name = nameOf(child);
      const index = seen.get(name) ?? 0;
      seen.set(name, index + 1);
      const path = `${prefix}${name}${(total.get(name) ?? 0) > 1 ? `[${index}]` : ""}`;
      const inner = named(child).find((c) => c.type === "body");
      if (!inner) {
        block.attributes.set(path, "{}");
        continue;
      }
      if (named(child)[0]?.text === "dynamic") flattenDynamic(inner, path, name, block, source, bound);
      else flattenBody(inner, `${path}.`, block, source, bound);
    }
  }
}

/** A `dynamic` block: `for_each` stays an attribute of the generated block, and `content` is its body. */
function flattenDynamic(body: Node, path: string, label: string, block: ParsedBlock, source: string, bound: string[]): void {
  let iterator = label;
  for (const attribute of childrenOf(body, "attribute")) {
    const [name, expression] = named(attribute);
    if (name?.text === "iterator" && expression) iterator = expression.text.trim();
  }
  for (const child of named(body)) {
    if (child.type === "attribute") {
      const [name, expression] = named(child);
      if (name && expression && name.text !== "iterator") flattenValue(expression, `${path}.${name.text}`, block, source, bound, 0);
    } else if (child.type === "block" && named(child)[0]?.text === "content") {
      const content = named(child).find((c) => c.type === "body");
      if (content) flattenBody(content, `${path}.`, block, source, [...bound, iterator]);
    }
  }
}

function flattenValue(expression: Node, path: string, block: ParsedBlock, source: string, bound: string[], depth: number): void {
  const object = depth < MAX_OBJECT_DEPTH ? objectLiteral(expression) : null;
  const elements = object ? childrenOf(object, "object_elem") : [];
  if (elements.length === 0 || elements.some((element) => !staticObjectKey(childrenOf(element, "expression")[0]))) {
    block.attributes.set(path, textOf(expression, source));
    for (const reference of referencesIn(expression, bound)) {
      let paths = block.references.get(reference);
      if (!paths) block.references.set(reference, (paths = new Set()));
      paths.add(path);
    }
    return;
  }
  for (const element of elements) {
    const [key, value] = childrenOf(element, "expression");
    if (key && value) flattenValue(value, `${path}.${unquote(textOf(key, source))}`, block, source, bound, depth + 1);
  }
}

/** Unquoted identifiers and plain quoted strings are literal object keys. */
function staticObjectKey(key: Node | undefined): boolean {
  const nodes = key ? named(key) : [];
  return nodes.length === 1 && (nodes[0].type === "variable_expr" || childrenOf(nodes[0], "string_lit").length > 0);
}

/** The object literal an expression is, if it is nothing else (not `merge(...)`, not a conditional). */
function objectLiteral(expression: Node): Node | null {
  const children = named(expression);
  if (children.length !== 1 || children[0].type !== "collection_value") return null;
  return named(children[0]).find((c) => c.type === "object") ?? null;
}

/** An expression's text without comments, whitespace collapsed: realigning or commenting a block changes nothing. */
function textOf(node: Node, source: string): string {
  let text = "";
  let at = node.startIndex;
  let outside = "";
  const normalize = (part: string) => part.replace(/\s+/g, " ");
  const walk = (n: Node) => {
    if (n.type === "comment") {
      outside += source.slice(at, n.startIndex) + " ";
      at = n.endIndex;
      return;
    }
    // Gaps between template tokens can contain literal spaces and newlines.
    if (n.type === "string_lit" || n.type === "quoted_template" || n.type === "heredoc_template") {
      text += normalize(outside + source.slice(at, n.startIndex)) + n.text;
      outside = "";
      at = n.endIndex;
      return;
    }
    for (const child of n.children) if (child) walk(child);
  };
  walk(node);
  return (text + normalize(outside + source.slice(at, node.endIndex))).trim();
}

/**
 * The addresses an expression uses: `var.x`, `local.x`, `data.type.name`, `module.name`, `type.name`.
 * Names bound by a `for` expression or a `dynamic` block are not references.
 */
function referencesIn(node: Node, bound: readonly string[], found = new Set<string>()): Set<string> {
  let scope = bound;
  if (node.type === "for_tuple_expr" || node.type === "for_object_expr") {
    const intro = named(node).find((c) => c.type === "for_intro");
    scope = [...bound, ...childrenOf(intro, "identifier").map((c) => c.text)];
  }
  if (node.type === "variable_expr") {
    const root = named(node)[0]?.text;
    const attributes: string[] = [];
    for (let next = node.nextNamedSibling; next; next = next.nextNamedSibling) {
      if (next.type === "get_attr") attributes.push(named(next)[0]?.text ?? "");
      else if (next.type !== "index" && next.type !== "splat" && next.type !== "legacy_index") break;
    }
    if (root && !BUILTIN_ROOTS.has(root) && !scope.includes(root)) {
      if (root === "var" && attributes[0]) found.add(`var.${attributes[0]}`);
      else if (root === "local" && attributes[0]) found.add(`local.${attributes[0]}`);
      else if (root === "data" && attributes[1]) found.add(`data.${attributes[0]}.${attributes[1]}`);
      else if (root === "module" && attributes[0]) found.add(`module.${attributes[0]}`);
      else if (attributes[0] && RESOURCE_TYPE.test(root)) found.add(`${root}.${attributes[0]}`);
    }
  }
  for (const child of named(node)) referencesIn(child, child.type === "for_intro" ? bound : scope, found);
  return found;
}
