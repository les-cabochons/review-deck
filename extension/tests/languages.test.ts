import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { mergeConfig } from "../../src/core/config";
import { isTestPath } from "../../src/core/paths";
import { createNodeParsers } from "../../src/node/parsers";
import { GRAMMARS } from "../../src/parse/grammars";
import { languageForPath } from "../../src/parse/languages";
import type { FileSymbols } from "../../src/parse/symbols";
import { runPipeline } from "../../src/pipeline";

const parsers = await createNodeParsers();

async function symbols(path: string, source: string): Promise<FileSymbols> {
  await parsers.load([path]);
  const syms = parsers.symbols(path, source);
  assert.ok(syms, `no symbols for ${path}`);
  return syms;
}

const decls = (s: FileSymbols) => s.decls.map((d) => `${d.kind} ${d.qualified}`);
/** Match keys of the identifiers declared on a 0-based row. */
const defKeys = (s: FileSymbols, row: number) => s.lines.get(row)?.idents.filter((i) => i.isDefName).flatMap((i) => i.keys) ?? [];
const refKeys = (s: FileSymbols, row: number) => s.lines.get(row)?.idents.filter((i) => !i.isDefName).flatMap((i) => i.keys) ?? [];
const imports = (s: FileSymbols) => s.imports.map((r) => `${r.match} ${r.path}`);

test("every grammar ships in the extension manifest", () => {
  const manifest = JSON.parse(readFileSync("extension/vss-extension.json", "utf8")) as { files: { path: string; contentType?: string }[] };
  for (const g of Object.values(GRAMMARS)) {
    const entry = manifest.files.find((f) => f.path === `assets/${g.file}`);
    assert.equal(entry?.contentType, "application/wasm", g.file);
  }
});

test("files map to grammars by extension", () => {
  assert.equal(languageForPath("src/a.ts"), "typescript");
  assert.equal(languageForPath("src/a.d.ts"), "typescript");
  assert.equal(languageForPath("src/a.jsx"), "tsx");
  assert.equal(languageForPath("app/models.py"), "python");
  assert.equal(languageForPath("include/foo.H"), "cpp");
  assert.equal(languageForPath("Gemfile"), null);
  assert.equal(languageForPath("dir.v2/README"), null);
  assert.equal(languageForPath("docs/a.md"), null);
});

test("test files are recognized across ecosystems", () => {
  for (const p of ["src/a.test.ts", "tests/test_models.py", "app/models_test.py", "pkg/util/util_test.go", "spec/user_spec.rb", "src/test/java/a/FooTest.java", "Foo.Tests/BarTests.cs", "src/foo_test.cpp"]) {
    assert.ok(isTestPath(p), p);
  }
  for (const p of ["src/a.ts", "app/models.py", "pkg/util/util.go", "src/main/java/a/Foo.java", "src/latest.py"]) assert.ok(!isTestPath(p), p);
});

test("python: classes, methods, module names and imports", async () => {
  const s = await symbols(
    "app/models.py",
    [
      "from .util import helper",
      "import app.db as db",
      "class User(Base):",
      "    table = 'users'",
      "    def __init__(self, name):",
      "        self.name = name",
      "    def save(self):",
      "        return db.write(self.name)",
      "LIMIT = 3",
      "def test_connection():",
      "    return True",
    ].join("\n"),
  );
  // test_* outside a test file is ordinary code.
  assert.deepEqual(decls(s), ["class User", "field User.table", "method User.__init__", "method User.save", "variable LIMIT", "function test_connection"]);
  assert.deepEqual(s.decls.find((d) => d.name === "__init__")?.constructs, "User");
  assert.deepEqual(defKeys(s, 6), [".save"]);
  // `db.write` may call a method, or module db's function `write`.
  assert.ok(refKeys(s, 7).includes(".write"));
  assert.ok(refKeys(s, 7).includes("write"));
  assert.ok(refKeys(s, 7).includes("db"));
  assert.deepEqual(imports(s), ["suffix ./util", "suffix ./util/helper", "suffix app/db", "suffix app"]);
  assert.ok(s.lines.get(0)?.isImport);
});

test("python: test functions in test files are tests", async () => {
  const s = await symbols("tests/test_models.py", ["def test_save():", "    assert save()"].join("\n"));
  assert.deepEqual(decls(s), ["test test_save"]);
});

test("go: types, methods, tests and package imports", async () => {
  const s = await symbols(
    "pkg/store/store.go",
    [
      "package store",
      'import "github.com/acme/app/internal/util"',
      "type Store struct {",
      "  Path string",
      "}",
      "func (s *Store) Save() error { return util.Write(s.Path) }",
      "func New() *Store { return &Store{} }",
      'func TestSave(t *testing.T) { t.Run("x", nil) }',
    ].join("\n"),
  );
  assert.deepEqual(decls(s), ["class Store", "field Store.Path", "method Save", "function New", "test TestSave"]);
  assert.deepEqual(defKeys(s, 5), [".Save"]);
  // `util.Write` calls package util's function Write, declared as plain `Write`.
  assert.ok(refKeys(s, 5).includes("Write"));
  assert.ok(refKeys(s, 5).includes(".Write"));
  assert.deepEqual(imports(s), ["directory github.com/acme/app/internal/util"]);
});

test("rust: impl methods, constructors, tests and use paths", async () => {
  const s = await symbols(
    "src/store.rs",
    [
      "use crate::util::{write, read};",
      "mod tests;",
      "pub struct Store { path: String }",
      "impl Store {",
      "    pub fn new() -> Self { Store { path: String::new() } }",
      "    pub fn save(&self) { write(&self.path) }",
      "}",
      "#[test]",
      "fn saves() { Store::new().save(); }",
    ].join("\n"),
  );
  assert.deepEqual(decls(s), ["class Store", "field Store.path", "class Store", "method Store.new", "method Store.save", "test saves"]);
  assert.equal(s.decls.find((d) => d.name === "new")?.constructs, "Store");
  assert.ok(refKeys(s, 8).includes(".new"));
  assert.ok(refKeys(s, 8).includes(".save"));
  // `mod tests;` in store.rs is store/tests.rs; in lib.rs it is a sibling.
  assert.deepEqual(imports(s), ["suffix util", "suffix ./store/tests", "suffix ./store/tests/mod"]);
  assert.deepEqual(imports(await symbols("src/lib.rs", "mod store;")), ["suffix ./store", "suffix ./store/mod"]);
});

test("java: members, constructors, annotated tests and imports", async () => {
  const s = await symbols(
    "src/main/java/com/acme/Store.java",
    [
      "package com.acme;",
      "import com.acme.util.Files;",
      "import com.acme.model.*;",
      "public class Store {",
      "  private String path;",
      "  public Store(String path) { this.path = path; }",
      "  public void save() { Files.write(this.path); flush(); }",
      "  @Test",
      "  void savesFile() { new Store(\"a\").save(); }",
      "}",
    ].join("\n"),
  );
  assert.deepEqual(decls(s), ["class Store", "field Store.path", "method Store.Store", "method Store.save", "test savesFile"]);
  assert.equal(s.decls.find((d) => d.kind === "method" && d.name === "Store")?.constructs, "Store");
  assert.ok(refKeys(s, 6).includes(".write"));
  assert.ok(refKeys(s, 6).includes(".flush"));
  assert.deepEqual(imports(s), ["suffix com/acme/util/Files", "suffix com/acme/util", "directory com/acme/model"]);
});

test("c#: classes, properties, xunit tests and usings", async () => {
  const s = await symbols(
    "src/Acme/Store.cs",
    [
      "using Acme.Util;",
      "namespace Acme;",
      "public class Store {",
      "  public string Path { get; set; }",
      "  public void Save() { Files.Write(Path); }",
      "  [Fact]",
      "  public void SavesFile() { new Store().Save(); }",
      "}",
    ].join("\n"),
  );
  assert.deepEqual(decls(s), ["class Store", "field Store.Path", "method Store.Save", "test SavesFile"]);
  assert.ok(refKeys(s, 4).includes(".Write"));
  assert.deepEqual(imports(s), ["directory Acme/Util"]);
});

test("ruby: modules, methods, rspec blocks and requires", async () => {
  const s = await symbols(
    "lib/acme/store.rb",
    [
      'require_relative "util"',
      "module Acme",
      "  class Store",
      "    def initialize(path); @path = path; end",
      "    def save; Util.write(@path); end",
      "  end",
      "end",
      'describe Acme::Store do',
      '  it "saves" do',
      "    Acme::Store.new('a').save",
      "  end",
      "end",
    ].join("\n"),
  );
  assert.deepEqual(decls(s), ["class Acme", "class Acme.Store", "method Acme.Store.initialize", "method Acme.Store.save", "test describe(Acme::Store)", 'test it("saves")']);
  assert.ok(refKeys(s, 9).includes(".save"));
  assert.deepEqual(imports(s), ["suffix ./util"]);
});

test("php: classes, properties, PHPUnit tests and use clauses", async () => {
  const s = await symbols(
    "tests/StoreTest.php",
    [
      "<?php",
      "namespace App;",
      "use App\\Util\\Files;",
      "use App\\Models\\{User, Sub\\Post};",
      "class Store {",
      "  private string $path;",
      "  public function __construct($path) { $this->path = $path; }",
      "  public function save() { return Files::write($this->path); }",
      "  public function testSave() { $this->save(); }",
      "}",
    ].join("\n"),
  );
  assert.deepEqual(decls(s), ["class Store", "field Store.path", "method Store.__construct", "method Store.save", "test testSave"]);
  assert.ok(refKeys(s, 7).includes(".write"));
  assert.ok(refKeys(s, 8).includes(".save"));
  assert.deepEqual(imports(s), [
    "suffix App/Util/Files",
    "suffix App/Util",
    "suffix App/Models/User",
    "suffix App/Models",
    "suffix App/Models/Sub/Post",
    "suffix App/Models/Sub",
  ]);
});

test("c/c++: classes, out-of-line methods, prototypes, gtest and includes", async () => {
  const s = await symbols(
    "src/store.cpp",
    [
      '#include "store.h"',
      "#include <vector>",
      "class Store {",
      " public:",
      "  void save();",
      "  int count = 0;",
      "};",
      "void Store::save() { write(this->count); }",
      "int helper(int a);",
      "static int total = 0;",
      "TEST(StoreTest, Saves) { Store().save(); }",
      "Store::Store() {}",
    ].join("\n"),
  );
  assert.deepEqual(decls(s), [
    "class Store",
    "method Store.save",
    "field Store.count",
    "method Store.save",
    "function helper",
    "variable total",
    "test TEST(StoreTest, Saves)",
    "method Store.Store",
  ]);
  // An out-of-line constructor still stands for its class.
  assert.equal(s.decls.at(-1)?.constructs, "Store");
  assert.deepEqual(defKeys(s, 7), [".save"]);
  assert.ok(refKeys(s, 7).includes(".count"));
  assert.deepEqual(imports(s), ["suffix ./store.h", "suffix store.h"]);
});

test("a python change and its callers in other files group together", async () => {
  const file = (path: string, old: string[], next: string[]) => ({ path, old: old.join("\n"), next: next.join("\n") });
  const files = [
    file("app/billing.py", ["def charge(user, amount):", "    return amount"], ["def charge(user, amount, currency):", "    return amount"]),
    file("app/checkout.py", ["from .billing import charge", "def pay(user):", "    return charge(user, 3)"], ["from .billing import charge", "def pay(user):", "    return charge(user, 3, 'eur')"]),
    file("tests/test_billing.py", ["from app.billing import charge", "def test_charge():", "    assert charge(1, 2) == 2"], ["from app.billing import charge", "def test_charge():", "    assert charge(1, 2, 'eur') == 2"]),
    file("docs/setup.md", ["# Setup", "Run it."], ["# Setup", "Run it with uv."]),
  ];
  const diff = files
    .map((f) => {
      const old = f.old.split("\n");
      const next = f.next.split("\n");
      const body = old.map((l, i) => (l === next[i] ? [` ${l}`] : [`-${l}`, `+${next[i]}`])).flat();
      return [`diff --git a/${f.path} b/${f.path}`, `--- a/${f.path}`, `+++ b/${f.path}`, `@@ -1,${old.length} +1,${next.length} @@`, ...body].join("\n");
    })
    .join("\n") + "\n";
  const contents = new Map(files.flatMap((f) => [[`old:${f.path}`, f.old], [`new:${f.path}`, f.next]] as const));
  const result = await runPipeline(
    { title: "Add currency to charge", description: "", diff, files: { get: async (p, side) => contents.get(`${side}:${p}`) ?? null } },
    mergeConfig({ semantic: { enabled: false } }),
    { parsers },
  );
  const billing = result.hunks.get("app/billing.py#0")!;
  assert.equal(billing.language, "python");
  assert.ok(billing.defines.has("charge"));
  assert.ok(result.hunks.get("tests/test_billing.py#0")!.fileImports.has("app/billing"));
  const groupOf = (id: string) => result.groups.find((g) => g.hunkIds.includes(id))!.id;
  assert.equal(groupOf("app/checkout.py#0"), groupOf("app/billing.py#0"));
  assert.equal(groupOf("tests/test_billing.py#0"), groupOf("app/billing.py#0"));
  assert.notEqual(groupOf("docs/setup.md#0"), groupOf("app/billing.py#0"));
});
