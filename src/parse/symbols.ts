import type { Node, Tree } from "web-tree-sitter";

/** A named declaration (rows are 0-based, inclusive). */
export interface Decl {
  name: string;
  qualified: string;
  kind: "function" | "class" | "interface" | "type" | "enum" | "method" | "field" | "variable" | "test";
  startRow: number;
  endRow: number;
  nameRow: number;
  /** For a constructor, the class it constructs: changing it stands for the class (`new Foo(...)`). */
  constructs?: string;
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
  /** Modules this file imports (or re-exports from). */
  imports: ImportRef[];
}

/** One imported module, resolved against the PR's changed files by `match`. */
export interface ImportRef {
  /** Slash-separated module path; starts with `./` or `../` when relative to the importing file. */
  path: string;
  /**
   * How a non-relative path finds files: `package` is the JS monorepo convention (`pkg/sub`),
   * `suffix` matches a file path ending in it (`com/acme/Foo`), and `directory` matches every file
   * in a directory ending in it (Go packages, C# namespaces).
   */
  match: "package" | "suffix" | "directory";
}

/** Where a leaf identifier is matched: plain `name`, member `.name`, or both. */
export type KeyStyle = "plain" | "member" | "both";

/** A declaration a spec found: its kind and the node holding its name. */
export interface DeclSite {
  kind: Decl["kind"];
  name: Node;
  /** Type named in the declaration itself (`void Foo::bar()`), when no enclosing declaration says it. */
  scope?: string;
}

/**
 * What one grammar contributes to symbol extraction. The walker in `extractSymbols` is shared; a
 * spec only names the node types and recognizes the constructs specific to its language. Hooks get
 * the node's `type` alongside it: reading `node.type` crosses into wasm, so the walker reads it once.
 */
export interface SymbolSpec {
  /** Leaf node types that are identifiers. */
  idents: ReadonlySet<string>;
  /** Match style of an identifier leaf (see `isField` for its position in its parent). */
  keyStyle(node: Node, type: string): KeyStyle;
  /** Node types holding a comment (not descended into). */
  comments: ReadonlySet<string>;
  /** Node types whose text is a string literal's content. */
  strings: ReadonlySet<string>;
  /** String literal node types that may span lines (every row counts as code). */
  multilineStrings: ReadonlySet<string>;
  /** A test case or suite (`describe("x", ...)`): its label and the node holding it. Checked before `decl`. */
  test?(node: Node, type: string, path: string): { label: string; at: Node } | null;
  /** Declaration introduced by `node`. */
  decl(node: Node, type: string, stack: readonly Decl[]): DeclSite | null;
  /** Names declared by `node` that get no declaration of their own (property signatures, fields). */
  defNames?(node: Node, type: string): { name: Node; style: KeyStyle }[];
  /** Modules imported by `node` (a file at `path`); `isImport` marks its rows as an import statement. */
  imports?(node: Node, type: string, path: string): { refs: ImportRef[]; isImport: boolean } | null;
  /** True for a method that constructs its type (`constructor`, `__init__`, `Foo()` in `class Foo`). */
  isConstructor?(name: string, owner: Pick<Decl, "name" | "kind">): boolean;
}

export function extractSymbols(tree: Tree, spec: SymbolSpec, path: string): FileSymbols {
  const decls: Decl[] = [];
  const lines = new Map<number, LineFacts>();
  const imports: ImportRef[] = [];
  // Identifier leaves that declare a name, by node id. A non-null style overrides `keyStyle`.
  const declared = new Map<number, KeyStyle | null>();

  const line = (row: number): LineFacts => {
    let f = lines.get(row);
    if (!f) {
      f = { idents: [], strings: [], comments: [], hasCode: false, isImport: false };
      lines.set(row, f);
    }
    return f;
  };

  const walk = (node: Node, stack: Decl[]) => {
    const type = node.type;
    let decl: Decl | null = null;

    const test = spec.test?.(node, type, path);
    const found = test ? null : spec.decl(node, type, stack);
    if (test) {
      decl = makeDecl({ kind: "test", name: test.at }, test.label, node, stack, spec);
    } else if (found) {
      // Members are matched as `.name`; plain identifiers keep their own style.
      declared.set(found.name.id, found.kind === "method" || found.kind === "field" ? "member" : null);
      decl = makeDecl(found, found.name.text, node, stack, spec);
    } else {
      for (const d of spec.defNames?.(node, type) ?? []) declared.set(d.name.id, d.style === "plain" ? null : d.style);
    }
    const imported = spec.imports?.(node, type, path);
    if (imported) {
      imports.push(...imported.refs);
      if (imported.isImport) for (let r = node.startPosition.row; r <= node.endPosition.row; r++) line(r).isImport = true;
    }

    if (decl) decls.push(decl);
    const nextStack = decl ? [...stack, decl] : stack;

    if (spec.comments.has(type)) {
      for (let r = node.startPosition.row; r <= node.endPosition.row; r++) line(r).comments.push(node.text);
      return;
    }
    if (spec.strings.has(type)) {
      line(node.startPosition.row).strings.push(node.text);
    }
    if (node.childCount === 0) {
      const f = line(node.startPosition.row);
      f.hasCode = true;
      if (spec.idents.has(type)) {
        const style = declared.get(node.id) ?? spec.keyStyle(node, type);
        f.idents.push({ text: node.text, keys: identKeys(style, node.text), isDefName: declared.has(node.id) });
        for (const d of nextStack) if (d.name !== node.text) d.refs.add(node.text);
      }
      return;
    }
    if (spec.multilineStrings.has(type)) {
      for (let r = node.startPosition.row; r <= node.endPosition.row; r++) line(r).hasCode = true;
    }
    for (const child of node.children) if (child) walk(child, nextStack);
  };

  walk(tree.rootNode, []);
  return { decls, lines, imports };
}

/** True when `node` sits in field `field` of a `parentType` node. */
export function isField(node: Node, parentType: string, field: string): boolean {
  const parent = node.parent;
  return parent?.type === parentType && parent.childForFieldName(field)?.id === node.id;
}

function identKeys(style: KeyStyle, text: string): string[] {
  if (style === "member") return [`.${text}`];
  if (style === "both") return [text, `.${text}`];
  return [text];
}

/** Match key for a declaration's name: members are `.name`, everything else plain. */
export function declKey(decl: Pick<Decl, "kind" | "name">): string {
  return decl.kind === "method" || decl.kind === "field" ? `.${decl.name}` : decl.name;
}

/** Nearest enclosing declaration that is not a test. */
export function enclosingDecl(stack: readonly Decl[]): Decl | undefined {
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i].kind !== "test") return stack[i];
  return undefined;
}

function makeDecl(site: DeclSite, name: string, node: Node, stack: Decl[], spec: SymbolSpec): Decl {
  const { kind, scope } = site;
  const parent = enclosingDecl(stack);
  const prefix = [parent?.qualified, scope].filter(Boolean).join(".");
  const owner = scope ? { name: scope, kind: "class" as const } : parent;
  return {
    name,
    qualified: kind === "test" || !prefix ? name : `${prefix}.${name}`,
    kind,
    constructs: kind !== "test" && owner && spec.isConstructor?.(name, owner) ? owner.name : undefined,
    startRow: node.startPosition.row,
    endRow: node.endPosition.row,
    nameRow: site.name.startPosition.row,
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
