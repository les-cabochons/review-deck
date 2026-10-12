import type { Node, Tree } from "web-tree-sitter";

/** A named declaration (rows are 0-based, inclusive). */
export interface Decl {
  name: string;
  qualified: string;
  kind: "function" | "class" | "interface" | "type" | "enum" | "method" | "field" | "variable" | "test";
  startRow: number;
  endRow: number;
  nameRow: number;
  /** Identifiers used anywhere inside the declaration (excluding its own name). */
  refs: Set<string>;
}

export interface Ident {
  text: string;
  /**
   * Match keys: `name` for plain identifiers (variables, functions, types), `.name` for members
   * (`x.name`, methods, fields, object keys). Shorthand `{ name }` yields both.
   */
  keys: string[];
  /** True when this identifier is being declared here (decl name, member/property name, object key). */
  isDefName: boolean;
}

export interface LineFacts {
  idents: Ident[];
  strings: string[];
  comments: string[];
  /** True if the line holds any non-comment syntax. */
  hasCode: boolean;
  isImport: boolean;
}

export interface FileSymbols {
  decls: Decl[];
  lines: Map<number, LineFacts>;
  /** Raw module specifiers of import / re-export statements. */
  imports: string[];
}

const DECL_KINDS: Record<string, Decl["kind"]> = {
  function_declaration: "function",
  generator_function_declaration: "function",
  class_declaration: "class",
  abstract_class_declaration: "class",
  interface_declaration: "interface",
  type_alias_declaration: "type",
  enum_declaration: "enum",
  method_definition: "method",
  method_signature: "method",
  abstract_method_signature: "method",
  public_field_definition: "field",
};

const IDENT_TYPES = new Set([
  "identifier",
  "type_identifier",
  "property_identifier",
  "shorthand_property_identifier",
  "shorthand_property_identifier_pattern",
  "private_property_identifier",
]);

const TEST_CALLS = new Set(["describe", "it", "test", "suite"]);

export function extractSymbols(tree: Tree): FileSymbols {
  const decls: Decl[] = [];
  const lines = new Map<number, LineFacts>();
  const imports: string[] = [];
  const defNameIds = new Set<number>();
  const memberDefIds = new Set<number>();

  const line = (row: number): LineFacts => {
    let f = lines.get(row);
    if (!f) {
      f = { idents: [], strings: [], comments: [], hasCode: false, isImport: false };
      lines.set(row, f);
    }
    return f;
  };

  const markDefName = (n: Node | null) => {
    if (n) defNameIds.add(n.id);
  };

  const walk = (node: Node, stack: Decl[], inImport: boolean) => {
    const type = node.type;
    let decl: Decl | null = null;

    const kind = DECL_KINDS[type];
    if (kind) {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        markDefName(nameNode);
        decl = makeDecl(nameNode.text, kind, node, nameNode, stack);
      }
    } else if (type === "variable_declarator") {
      const nameNode = node.childForFieldName("name");
      const value = node.childForFieldName("value");
      const statement = node.parent;
      const topLevel = statement?.parent?.type === "program" || statement?.parent?.parent?.type === "program";
      // Locals are not symbols: only module-level and function-valued declarators define a name.
      if (nameNode?.type === "identifier" && (topLevel || value?.type === "arrow_function" || value?.type === "function_expression")) {
        markDefName(nameNode);
        decl = makeDecl(nameNode.text, "variable", node, nameNode, stack);
      }
    } else if (type === "property_signature") {
      markDefName(node.childForFieldName("name"));
    } else if (type === "required_parameter" || type === "optional_parameter") {
      // TS parameter properties: `constructor(public readonly x: T)` declare a member.
      if (node.children.some((c) => c?.type === "accessibility_modifier" || c?.type === "readonly")) {
        const pattern = node.childForFieldName("pattern");
        markDefName(pattern);
        if (pattern) memberDefIds.add(pattern.id);
      }
    } else if (type === "call_expression") {
      const fn = node.childForFieldName("function");
      const args = node.childForFieldName("arguments");
      const first = args?.namedChildren[0];
      if (fn && TEST_CALLS.has(fn.text) && first && (first.type === "string" || first.type === "template_string")) {
        const label = first.text.slice(1, -1);
        decl = makeDecl(`${fn.text}("${label}")`, "test", node, first, stack);
      }
    } else if (type === "import_statement" || type === "export_statement") {
      const source = node.childForFieldName("source");
      if (source) imports.push(source.text.slice(1, -1));
      if (type === "import_statement") {
        inImport = true;
        for (let r = node.startPosition.row; r <= node.endPosition.row; r++) line(r).isImport = true;
      }
    }

    if (decl) decls.push(decl);
    const nextStack = decl ? [...stack, decl] : stack;

    if (type === "comment") {
      for (let r = node.startPosition.row; r <= node.endPosition.row; r++) line(r).comments.push(node.text);
      return;
    }
    if (type === "string_fragment") {
      line(node.startPosition.row).strings.push(node.text);
    }
    if (node.childCount === 0) {
      const f = line(node.startPosition.row);
      f.hasCode = true;
      if (IDENT_TYPES.has(type)) {
        f.idents.push({ text: node.text, keys: identKeys(type, node.text, memberDefIds.has(node.id)), isDefName: defNameIds.has(node.id) });
        for (const d of stack) if (d.name !== node.text) d.refs.add(node.text);
        if (decl && decl.name !== node.text) decl.refs.add(node.text);
      }
      return;
    }
    // Multi-line strings/templates: mark every row as code.
    if (type === "template_string" || type === "string") {
      for (let r = node.startPosition.row; r <= node.endPosition.row; r++) line(r).hasCode = true;
    }
    for (const child of node.children) if (child) walk(child, nextStack, inImport);
  };

  walk(tree.rootNode, [], false);
  return { decls, lines, imports };
}

function identKeys(type: string, text: string, memberDef: boolean): string[] {
  if (type === "property_identifier" || type === "private_property_identifier") return [`.${text}`];
  if (type.startsWith("shorthand_property_identifier") || memberDef) return [text, `.${text}`];
  return [text];
}

/** Match key for a declaration's name: members are `.name`, everything else plain. */
export function declKey(decl: Pick<Decl, "kind" | "name">): string {
  return decl.kind === "method" || decl.kind === "field" ? `.${decl.name}` : decl.name;
}

function makeDecl(name: string, kind: Decl["kind"], node: Node, nameNode: Node, stack: Decl[]): Decl {
  const parent = [...stack].reverse().find((d) => d.kind !== "test");
  const qualified = kind === "test" || !parent ? name : `${parent.qualified}.${name}`;
  return {
    name,
    qualified,
    kind,
    startRow: node.startPosition.row,
    endRow: node.endPosition.row,
    nameRow: nameNode.startPosition.row,
    refs: new Set(),
  };
}

/** Innermost declaration containing `row`, preferring non-test decls of equal span. */
export function innermostDecl(decls: Decl[], row: number): Decl | null {
  let best: Decl | null = null;
  for (const d of decls) {
    if (d.startRow > row || d.endRow < row) continue;
    if (!best || d.endRow - d.startRow < best.endRow - best.startRow) best = d;
  }
  return best;
}
