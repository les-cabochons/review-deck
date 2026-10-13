import type { Node } from "web-tree-sitter";
import { basename, isTestPath } from "../core/paths.js";
import { GRAMMARS, type LanguageId } from "./grammars.js";
import { type Decl, type DeclSite, enclosingDecl, type ImportRef, isField, type SymbolSpec } from "./symbols.js";

export interface LanguageInfo {
  spec: SymbolSpec;
  /** Builtins and idioms too common in this language to link hunks (added to the configured stopwords). */
  stopwords?: string[];
}

const nodeTypes = (...types: string[]): ReadonlySet<string> => new Set(types);

/** A declaration of `kind` whose name is in `node`'s `field`. */
const declNamed = (node: Node, kind: Decl["kind"], field = "name"): DeclSite | null => {
  const name = node.childForFieldName(field);
  return name ? { kind, name } : null;
};

/** True when the nearest enclosing declaration is a type, so a function there is a method. */
const inType = (stack: readonly Decl[]) => {
  const kind = enclosingDecl(stack)?.kind;
  return kind === "class" || kind === "interface" || kind === "enum";
};

/** The string literal's content without quotes. */
const unquote = (text: string) => text.replace(/^[a-zA-Z]*["'`]+|["'`]+$/g, "");

/** `a/b/c` plus its parent `a/b`, both matched as path suffixes (the last segment may be a symbol, not a file). */
const pathAndParent = (parts: string[]): ImportRef[] => {
  const clean = parts.filter(Boolean);
  if (clean.length === 0) return [];
  const refs: ImportRef[] = [{ path: clean.join("/"), match: "suffix" }];
  if (clean.length > 1) refs.push({ path: clean.slice(0, -1).join("/"), match: "suffix" });
  return refs;
};

const sameAsClass = (name: string, owner: Pick<Decl, "name" | "kind">) => owner.kind === "class" && owner.name === name;

// ---- TypeScript / JavaScript ----

const TS_DECLS: Record<string, Decl["kind"]> = {
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

const TS_TEST_CALLS = nodeTypes("describe", "it", "test", "suite");

const typescript: SymbolSpec = {
  idents: nodeTypes(
    "identifier",
    "type_identifier",
    "property_identifier",
    "shorthand_property_identifier",
    "shorthand_property_identifier_pattern",
    "private_property_identifier",
  ),
  keyStyle(_node, type) {
    if (type === "property_identifier" || type === "private_property_identifier") return "member";
    if (type.startsWith("shorthand_property_identifier")) return "both";
    return "plain";
  },
  comments: nodeTypes("comment"),
  strings: nodeTypes("string_fragment"),
  multilineStrings: nodeTypes("template_string", "string"),
  decl(node, type) {
    const kind = TS_DECLS[type];
    if (kind) return declNamed(node, kind);
    if (type !== "variable_declarator") return null;
    const name = node.childForFieldName("name");
    const value = node.childForFieldName("value");
    const statement = node.parent;
    const topLevel = statement?.parent?.type === "program" || statement?.parent?.parent?.type === "program";
    // Locals are not symbols: only module-level and function-valued declarators define a name.
    if (name?.type === "identifier" && (topLevel || value?.type === "arrow_function" || value?.type === "function_expression")) {
      return { kind: "variable", name };
    }
    return null;
  },
  defNames(node, type) {
    if (type === "property_signature") {
      const name = node.childForFieldName("name");
      return name ? [{ name, style: "plain" }] : [];
    }
    if (type === "required_parameter" || type === "optional_parameter") {
      // TS parameter properties: `constructor(public readonly x: T)` declare a member.
      const pattern = node.childForFieldName("pattern");
      if (pattern && node.children.some((c) => c?.type === "accessibility_modifier" || c?.type === "readonly")) {
        return [{ name: pattern, style: "both" }];
      }
    }
    return [];
  },
  test(node, type) {
    if (type !== "call_expression") return null;
    const fn = node.childForFieldName("function");
    const first = node.childForFieldName("arguments")?.namedChildren[0];
    if (!fn || !TS_TEST_CALLS.has(fn.text) || !first || (first.type !== "string" && first.type !== "template_string")) return null;
    return { label: `${fn.text}("${first.text.slice(1, -1)}")`, at: first };
  },
  imports(node, type) {
    if (type !== "import_statement" && type !== "export_statement") return null;
    const source = node.childForFieldName("source");
    const refs: ImportRef[] = source ? [{ path: source.text.slice(1, -1), match: "package" }] : [];
    return { refs, isImport: type === "import_statement" };
  },
  isConstructor: (name) => name === "constructor",
};

// ---- Python ----

const python: SymbolSpec = {
  idents: nodeTypes("identifier"),
  // `x.name` is a member, or as often a function of module `x`.
  keyStyle: (node) => (isField(node, "attribute", "attribute") ? "both" : "plain"),
  comments: nodeTypes("comment"),
  strings: nodeTypes("string_content"),
  multilineStrings: nodeTypes("string"),
  decl(node, type, stack) {
    switch (type) {
      case "class_definition":
        return declNamed(node, "class");
      case "function_definition":
        return declNamed(node, inType(stack) ? "method" : "function");
      case "assignment": {
        // Module-level names and class attributes; locals are not symbols.
        const left = node.childForFieldName("left");
        const scope = node.parent?.type === "expression_statement" ? node.parent.parent : null;
        if (left?.type !== "identifier" || !scope) return null;
        if (scope.type === "module") return { kind: "variable", name: left };
        if (scope.parent?.type === "class_definition") return { kind: "field", name: left };
        return null;
      }
    }
    return null;
  },
  test(node, type, path) {
    if (type !== "function_definition" || !isTestPath(path)) return null;
    const name = node.childForFieldName("name");
    return name && /^test/.test(name.text) ? { label: name.text, at: name } : null;
  },
  imports(node, type) {
    if (type === "import_statement") {
      const refs = node.childrenForFieldName("name").flatMap((n) => {
        const dotted = n?.type === "aliased_import" ? n.childForFieldName("name") : n;
        return dotted ? pathAndParent(dotted.text.split(".")) : [];
      });
      return { refs, isImport: true };
    }
    if (type !== "import_from_statement") return null;
    const module = node.childForFieldName("module_name");
    if (!module) return null;
    let base: string;
    if (module.type === "relative_import") {
      const dots = module.text.match(/^\.+/)?.[0].length ?? 1;
      const rest = module.text.slice(dots).split(".").filter(Boolean).join("/");
      base = (dots === 1 ? "./" : "../".repeat(dots - 1)) + rest;
    } else {
      base = module.text.split(".").join("/");
    }
    const sep = base.endsWith("/") ? "" : "/";
    const refs: ImportRef[] = [];
    if (!base.endsWith("/")) refs.push({ path: base, match: "suffix" });
    // `from pkg import mod` imports a module as often as a symbol.
    for (const n of node.childrenForFieldName("name")) {
      const name = n?.type === "aliased_import" ? n.childForFieldName("name") : n;
      if (name) refs.push({ path: `${base}${sep}${name.text}`, match: "suffix" });
    }
    return { refs, isImport: true };
  },
  isConstructor: (name) => name === "__init__",
};

// ---- Go ----

const GO_TEST = /^(Test|Benchmark|Fuzz|Example)/;

const go: SymbolSpec = {
  idents: nodeTypes("identifier", "type_identifier", "field_identifier", "package_identifier"),
  keyStyle(node, type) {
    if (type !== "field_identifier") return "plain";
    // `pkg.Func` calls into another package as often as `x.Method` calls a method.
    return isField(node, "selector_expression", "field") ? "both" : "member";
  },
  comments: nodeTypes("comment"),
  strings: nodeTypes("interpreted_string_literal_content", "raw_string_literal_content"),
  multilineStrings: nodeTypes("interpreted_string_literal", "raw_string_literal"),
  decl(node, type) {
    switch (type) {
      case "function_declaration":
        return declNamed(node, "function");
      case "method_declaration":
      case "method_elem":
        return declNamed(node, "method");
      case "field_declaration":
        return declNamed(node, "field");
      case "type_spec":
      case "type_alias": {
        const body = node.childForFieldName("type")?.type;
        return declNamed(node, body === "struct_type" ? "class" : body === "interface_type" ? "interface" : "type");
      }
      case "const_spec":
      case "var_spec":
        return node.parent?.parent?.type === "source_file" ? declNamed(node, "variable") : null;
    }
    return null;
  },
  test(node, type) {
    if (type !== "function_declaration") return null;
    const name = node.childForFieldName("name");
    return name && GO_TEST.test(name.text) ? { label: name.text, at: name } : null;
  },
  imports(node, type) {
    if (type !== "import_declaration") return null;
    const refs = node.descendantsOfType("import_spec").flatMap((spec): ImportRef[] => {
      const path = spec?.childForFieldName("path");
      return path ? [{ path: unquote(path.text), match: "directory" }] : [];
    });
    return { refs, isImport: true };
  },
};

// ---- Rust ----

const isRustTest = (node: Node) => {
  for (let s = node.previousNamedSibling; s?.type === "attribute_item"; s = s.previousNamedSibling) {
    if (/^#\[(\w+::)?test\b/.test(s.text)) return true;
  }
  return false;
};

const rust: SymbolSpec = {
  idents: nodeTypes("identifier", "type_identifier", "field_identifier"),
  keyStyle(node, type) {
    if (type === "field_identifier") return "member";
    // `Foo::new()` calls an associated function, declared as a method.
    if (isField(node, "scoped_identifier", "name")) return "both";
    return "plain";
  },
  comments: nodeTypes("line_comment", "block_comment"),
  strings: nodeTypes("string_content"),
  multilineStrings: nodeTypes("string_literal", "raw_string_literal"),
  decl(node, type, stack) {
    switch (type) {
      case "function_item":
      case "function_signature_item":
        return declNamed(node, inType(stack) ? "method" : "function");
      case "struct_item":
      case "union_item":
        return declNamed(node, "class");
      case "enum_item":
        return declNamed(node, "enum");
      case "trait_item":
        return declNamed(node, "interface");
      case "type_item":
        return declNamed(node, "type");
      case "const_item":
      case "static_item":
        return declNamed(node, "variable");
      case "macro_definition":
        return declNamed(node, "function");
      case "field_declaration":
        return declNamed(node, "field");
      case "impl_item": {
        // `impl Foo` / `impl Trait for Foo<T>` holds Foo's methods.
        let target = node.childForFieldName("type");
        if (target?.type === "generic_type") target = target.childForFieldName("type");
        return target ? { kind: "class", name: target } : null;
      }
    }
    return null;
  },
  test(node, type) {
    if (type !== "function_item" || !isRustTest(node)) return null;
    const name = node.childForFieldName("name");
    return name ? { label: name.text, at: name } : null;
  },
  imports(node, type, path) {
    if (type === "mod_item" && !node.childForFieldName("body")) {
      const name = node.childForFieldName("name")?.text;
      if (!name) return null;
      // `mod b;` is a sibling file from lib.rs, main.rs and mod.rs, and lives under `a/` from a.rs.
      const stem = basename(path).replace(/\.rs$/, "");
      const dir = ["lib", "main", "mod"].includes(stem) ? "." : `./${stem}`;
      return { refs: [{ path: `${dir}/${name}`, match: "suffix" }, { path: `${dir}/${name}/mod`, match: "suffix" }], isImport: true };
    }
    if (type !== "use_declaration") return null;
    const arg = node.childForFieldName("argument")?.text.replace(/\s+/g, "") ?? "";
    const segments = arg.split(/::\{|\bas\b/)[0].split("::").filter((p) => !["crate", "self", "super", ""].includes(p));
    return { refs: pathAndParent(segments), isImport: true };
  },
  isConstructor: (name, owner) => name === "new" && owner.kind === "class",
};

// ---- Java ----

const JAVA_TEST = /@(Test|ParameterizedTest|RepeatedTest|TestFactory)\b/;
const javaModifiers = (node: Node) => node.children.find((c) => c?.type === "modifiers")?.text ?? "";

const java: SymbolSpec = {
  idents: nodeTypes("identifier", "type_identifier"),
  keyStyle(node) {
    if (isField(node, "field_access", "field")) return "member";
    // An unqualified call may be a method of the enclosing class.
    if (isField(node, "method_invocation", "name")) return "both";
    return "plain";
  },
  comments: nodeTypes("line_comment", "block_comment"),
  strings: nodeTypes("string_fragment", "multiline_string_fragment"),
  multilineStrings: nodeTypes("string_literal"),
  decl(node, type) {
    switch (type) {
      case "class_declaration":
      case "record_declaration":
        return declNamed(node, "class");
      case "interface_declaration":
      case "annotation_type_declaration":
        return declNamed(node, "interface");
      case "enum_declaration":
        return declNamed(node, "enum");
      case "method_declaration":
      case "constructor_declaration":
        return declNamed(node, "method");
      case "field_declaration":
      case "constant_declaration": {
        const name = node.childForFieldName("declarator")?.childForFieldName("name");
        return name ? { kind: "field", name } : null;
      }
    }
    return null;
  },
  test(node, type) {
    if (type !== "method_declaration" || !JAVA_TEST.test(javaModifiers(node))) return null;
    const name = node.childForFieldName("name");
    return name ? { label: name.text, at: name } : null;
  },
  imports(node, type) {
    if (type !== "import_declaration") return null;
    const path = node.text.replace(/^import\s+(static\s+)?|\s*;\s*$/g, "").replace(/\s+/g, "");
    if (path.endsWith(".*")) return { refs: [{ path: path.slice(0, -2).split(".").join("/"), match: "directory" }], isImport: true };
    return { refs: pathAndParent(path.split(".")), isImport: true };
  },
  isConstructor: sameAsClass,
};

// ---- C# ----

const CS_TEST = /\b(Fact|Theory|Test|TestMethod|TestCase)\b/;
const csAttributes = (node: Node) =>
  node.children.filter((c) => c?.type === "attribute_list").map((c) => c!.text).join(" ");

const csharp: SymbolSpec = {
  idents: nodeTypes("identifier"),
  keyStyle(node) {
    if (isField(node, "member_access_expression", "name")) return "member";
    if (isField(node, "invocation_expression", "function")) return "both";
    return "plain";
  },
  comments: nodeTypes("comment"),
  strings: nodeTypes("string_literal_content", "verbatim_string_literal", "raw_string_content"),
  multilineStrings: nodeTypes("string_literal", "verbatim_string_literal", "raw_string_literal", "interpolated_string_expression"),
  decl(node, type) {
    switch (type) {
      case "class_declaration":
      case "struct_declaration":
      case "record_declaration":
        return declNamed(node, "class");
      case "interface_declaration":
        return declNamed(node, "interface");
      case "enum_declaration":
        return declNamed(node, "enum");
      case "delegate_declaration":
        return declNamed(node, "type");
      case "method_declaration":
      case "constructor_declaration":
        return declNamed(node, "method");
      case "property_declaration":
      case "event_declaration":
        return declNamed(node, "field");
      case "local_function_statement":
        return declNamed(node, "function");
      case "field_declaration": {
        const declarator = node.descendantsOfType("variable_declarator")[0];
        const name = declarator?.childForFieldName("name");
        return name ? { kind: "field", name } : null;
      }
    }
    return null;
  },
  test(node, type) {
    if (type !== "method_declaration" || !CS_TEST.test(csAttributes(node))) return null;
    const name = node.childForFieldName("name");
    return name ? { label: name.text, at: name } : null;
  },
  imports(node, type) {
    if (type !== "using_directive") return null;
    const target = node.namedChildren.filter((c) => c?.type === "qualified_name" || c?.type === "identifier").at(-1);
    return { refs: target ? [{ path: target.text.split(".").join("/"), match: "directory" }] : [], isImport: true };
  },
  isConstructor: sameAsClass,
};

// ---- Ruby ----

const RUBY_TEST_CALLS = nodeTypes("describe", "context", "it", "specify", "test", "scenario", "feature");

const ruby: SymbolSpec = {
  idents: nodeTypes("identifier", "constant"),
  // Every Ruby call is a method call, receiver or not.
  keyStyle: (node) => (isField(node, "call", "method") ? "both" : "plain"),
  comments: nodeTypes("comment"),
  strings: nodeTypes("string_content"),
  multilineStrings: nodeTypes("string", "heredoc_body"),
  decl(node, type, stack) {
    switch (type) {
      case "class":
      case "module":
        return declNamed(node, "class");
      case "method":
        return declNamed(node, inType(stack) ? "method" : "function");
      case "singleton_method":
        return declNamed(node, "method");
      case "assignment": {
        const left = node.childForFieldName("left");
        return left?.type === "constant" ? { kind: "variable", name: left } : null;
      }
    }
    return null;
  },
  test(node, type) {
    if (type !== "call" || !node.childForFieldName("block")) return null;
    const method = node.childForFieldName("method");
    if (!method || !RUBY_TEST_CALLS.has(method.text)) return null;
    const first = node.childForFieldName("arguments")?.namedChildren[0];
    return { label: first ? `${method.text}(${first.text})` : method.text, at: first ?? method };
  },
  imports(node, type) {
    if (type !== "call") return null;
    const method = node.childForFieldName("method")?.text;
    if (method !== "require" && method !== "require_relative" && method !== "load") return null;
    const first = node.childForFieldName("arguments")?.namedChildren[0];
    if (first?.type !== "string") return null;
    const path = unquote(first.text).replace(/\.rb$/, "");
    return { refs: [{ path: method === "require_relative" ? `./${path}` : path, match: "suffix" }], isImport: true };
  },
  isConstructor: (name) => name === "initialize",
};

// ---- PHP ----

const php: SymbolSpec = {
  idents: nodeTypes("name"),
  keyStyle(node) {
    const parent = node.parent?.type ?? "";
    if (!isField(node, parent, "name")) return "plain";
    if (/^(nullsafe_)?member_(call|access)_expression$/.test(parent)) return "member";
    if (parent === "scoped_call_expression" || parent === "scoped_property_access_expression") return "both";
    return "plain";
  },
  comments: nodeTypes("comment"),
  strings: nodeTypes("string_content", "string_value"),
  multilineStrings: nodeTypes("string", "encapsed_string", "heredoc", "nowdoc"),
  decl(node, type) {
    switch (type) {
      case "class_declaration":
      case "trait_declaration":
        return declNamed(node, "class");
      case "interface_declaration":
        return declNamed(node, "interface");
      case "enum_declaration":
        return declNamed(node, "enum");
      case "function_definition":
        return declNamed(node, "function");
      case "method_declaration":
        return declNamed(node, "method");
      case "property_element": {
        // `$x` is a variable_name holding a name.
        const name = node.childForFieldName("name")?.namedChildren[0];
        return name ? { kind: "field", name } : null;
      }
      case "const_element": {
        const name = node.namedChildren.find((c) => c?.type === "name");
        return name ? { kind: "field", name } : null;
      }
    }
    return null;
  },
  test(node, type, path) {
    if (type !== "method_declaration" || !isTestPath(path)) return null;
    const name = node.childForFieldName("name");
    return name && /^test/.test(name.text) ? { label: name.text, at: name } : null;
  },
  imports(node, type) {
    if (type === "namespace_use_declaration") {
      // `use A\B\{C, D\E}` names the shared prefix before the group.
      const prefix = node.namedChildren.find((c) => c?.type === "namespace_name")?.text;
      const refs = node.descendantsOfType("namespace_use_clause").flatMap((clause) => {
        const target = clause?.namedChildren.find((c) => c?.type === "qualified_name" || c?.type === "name");
        if (!target) return [];
        const name = prefix ? `${prefix}\\${target.text}` : target.text;
        return pathAndParent(name.replace(/^\\/, "").split("\\"));
      });
      return { refs, isImport: true };
    }
    if (!/^(require|include)(_once)?_expression$/.test(type)) return null;
    const literal = node.namedChildren.find((c) => c?.type === "string" || c?.type === "encapsed_string");
    if (!literal) return { refs: [], isImport: true };
    const path = unquote(literal.text).replace(/\.php$/, "").replace(/^\//, "");
    return { refs: [{ path: path.startsWith(".") ? path : `./${path}`, match: "suffix" }], isImport: true };
  },
  isConstructor: (name) => name === "__construct",
};

// ---- C / C++ ----

const CPP_TEST_MACROS = nodeTypes("TEST", "TEST_F", "TEST_P", "TYPED_TEST", "TEST_CASE", "SCENARIO");

/**
 * Follows a C declarator (`*name`, `name(...)`, `name[3]`, `A::name`) down to its name. Notes if it
 * declares a function, and the type it is qualified by (`A` in `A::name`).
 */
function cppDeclarator(node: Node | null): { name: Node; scope?: string; fn: boolean } | null {
  let fn = false;
  for (let d = node; d; ) {
    switch (d.type) {
      case "identifier":
      case "field_identifier":
      case "type_identifier":
      case "operator_name":
      case "destructor_name":
        return { name: d, fn };
      case "qualified_identifier": {
        let scope = d.childForFieldName("scope");
        let name = d.childForFieldName("name");
        while (name?.type === "qualified_identifier") {
          scope = name.childForFieldName("scope");
          name = name.childForFieldName("name");
        }
        return name ? { name, scope: scope?.text, fn } : null;
      }
      case "function_declarator":
        fn = true;
        d = d.childForFieldName("declarator");
        break;
      default:
        d = d.childForFieldName("declarator");
    }
  }
  return null;
}

const cppScope = nodeTypes("translation_unit", "declaration_list", "preproc_if", "preproc_ifdef", "preproc_else", "linkage_specification");

const cpp: SymbolSpec = {
  idents: nodeTypes("identifier", "type_identifier", "field_identifier", "namespace_identifier"),
  keyStyle(node, type) {
    if (type === "field_identifier") return "member";
    if (isField(node, "qualified_identifier", "name")) return "both";
    return "plain";
  },
  comments: nodeTypes("comment"),
  strings: nodeTypes("string_content"),
  multilineStrings: nodeTypes("string_literal", "raw_string_literal"),
  decl(node, type, stack) {
    switch (type) {
      case "class_specifier":
      case "struct_specifier":
      case "union_specifier":
        return node.childForFieldName("body") ? declNamed(node, "class") : null;
      case "enum_specifier":
        return node.childForFieldName("body") ? declNamed(node, "enum") : null;
      case "type_definition": {
        const d = cppDeclarator(node.childForFieldName("declarator"));
        return d ? { kind: "type", name: d.name } : null;
      }
      case "alias_declaration":
        return declNamed(node, "type");
      case "preproc_def":
        return declNamed(node, "variable");
      case "preproc_function_def":
        return declNamed(node, "function");
      case "function_definition": {
        const d = cppDeclarator(node.childForFieldName("declarator"));
        if (!d) return null;
        // `void Foo::bar() {}` outside the class is Foo's method.
        if (d.scope && !inType(stack)) return { kind: "method", name: d.name, scope: d.scope };
        return { kind: inType(stack) ? "method" : "function", name: d.name };
      }
      case "field_declaration": {
        const d = cppDeclarator(node.childForFieldName("declarator"));
        return d ? { kind: d.fn ? "method" : "field", name: d.name } : null;
      }
      case "declaration": {
        // Prototypes and globals; locals are not symbols.
        if (!node.parent || !cppScope.has(node.parent.type)) return null;
        const d = cppDeclarator(node.childForFieldName("declarator"));
        return d ? { kind: d.fn ? "function" : "variable", name: d.name } : null;
      }
    }
    return null;
  },
  test(node, type) {
    if (type !== "function_definition") return null;
    const declarator = node.childForFieldName("declarator");
    const d = cppDeclarator(declarator);
    if (!d || !CPP_TEST_MACROS.has(d.name.text)) return null;
    const params = declarator?.childForFieldName("parameters");
    return { label: `${d.name.text}${params?.text ?? ""}`, at: d.name };
  },
  imports(node, type) {
    if (type !== "preproc_include") return null;
    const path = node.childForFieldName("path");
    if (path?.type !== "string_literal") return { refs: [], isImport: true };
    const file = unquote(path.text);
    return { refs: [{ path: file.startsWith(".") ? file : `./${file}`, match: "suffix" }, { path: file, match: "suffix" }], isImport: true };
  },
  isConstructor: sameAsClass,
};

// ---- registry ----

export const LANGUAGES: Record<LanguageId, LanguageInfo> = {
  typescript: { spec: typescript },
  tsx: { spec: typescript },
  python: {
    spec: python,
    stopwords: [
      "self", "cls", "None", "True", "False", "str", "int", "float", "bool", "dict", "list", "tuple", "bytes",
      "len", "print", "range", "isinstance", "super", "Optional", "Any", "List", "Dict", "pytest", "fixture",
      "__init__", "kwargs", "append",
    ],
  },
  go: {
    spec: go,
    stopwords: [
      "err", "nil", "ctx", "fmt", "int", "int64", "uint", "byte", "bool", "error", "make", "len", "append",
      "Errorf", "Sprintf", "Println", "context", "Context", "testing", "Fatal", "Fatalf", "iota",
    ],
  },
  rust: {
    spec: rust,
    stopwords: [
      "self", "Self", "Ok", "Err", "Some", "None", "Option", "Result", "Vec", "String", "Box", "clone", "unwrap",
      "expect", "into", "iter", "mut", "usize", "u32", "u64", "i32", "i64", "f64", "str", "bool", "new", "assert_eq",
      "assert", "println", "format", "derive", "Debug", "Clone",
    ],
  },
  java: {
    spec: java,
    stopwords: [
      "String", "Object", "List", "Map", "Override", "void", "int", "long", "var", "this", "super", "Integer",
      "Long", "assertEquals", "assertThat", "assertTrue", "assertFalse", "Test", "Optional", "System", "out",
      "println", "equals", "hashCode", "toString",
    ],
  },
  csharp: {
    spec: csharp,
    stopwords: [
      "var", "string", "int", "long", "bool", "void", "Task", "async", "await", "List", "Assert", "this", "base",
      "Equal", "True", "False", "Fact", "Theory", "Console", "WriteLine", "ToString", "nameof", "IEnumerable",
    ],
  },
  ruby: {
    spec: ruby,
    stopwords: [
      "self", "nil", "true", "false", "require", "require_relative", "attr_reader", "attr_accessor", "attr_writer",
      "puts", "expect", "let", "subject", "before", "context", "described_class", "new", "each", "map", "raise",
    ],
  },
  php: {
    spec: php,
    stopwords: [
      "this", "self", "parent", "static", "array", "null", "true", "false", "string", "int", "bool", "void",
      "function", "return", "assertEquals", "assertSame", "assertTrue", "count", "isset", "empty",
    ],
  },
  cpp: {
    spec: cpp,
    stopwords: [
      "std", "int", "char", "void", "auto", "const", "size_t", "nullptr", "NULL", "this", "unsigned", "uint8_t",
      "uint32_t", "uint64_t", "int64_t", "vector", "string", "unique_ptr", "shared_ptr", "make_unique", "move",
      "sizeof", "static_cast", "return", "EXPECT_EQ", "ASSERT_EQ", "EXPECT_TRUE",
    ],
  },
};

const BY_EXTENSION = new Map<string, LanguageId>(
  (Object.keys(GRAMMARS) as LanguageId[]).flatMap((id) => GRAMMARS[id].extensions.map((ext) => [ext, id] as const)),
);

/** The grammar that parses `path`, by extension; null for files only grouped by path and shared names. */
export function languageForPath(path: string): LanguageId | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0 || dot < path.lastIndexOf("/")) return null;
  return BY_EXTENSION.get(path.slice(dot + 1).toLowerCase()) ?? null;
}
