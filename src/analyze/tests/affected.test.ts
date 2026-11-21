import assert from "node:assert/strict";
import { test } from "node:test";
import { structuredPatch } from "diff";
import { mergeConfig } from "../../core/config.js";
import type { FileProvider, HunkInfo } from "../../core/types.js";
import { parseDiff } from "../../diff/parse.js";
import { createNodeParsers } from "../../node/parsers.js";
import { analyzeHunks } from "../hunks.js";

const parsers = await createNodeParsers();

/** The analysed hunks of one modified file, in file order, parsed with the real grammar for `path`. */
async function analyze(path: string, before: string[], after: string[]): Promise<HunkInfo[]> {
  const [oldText, newText] = [before.join("\n"), after.join("\n")];
  const patch = structuredPatch(path, path, oldText, newText, "", "", { context: 0 });
  const diff = [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    ...patch.hunks.flatMap((h) => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines]),
    "",
  ].join("\n");
  const files: FileProvider = { get: async (_path, side) => (side === "old" ? oldText : newText) };
  return [...(await analyzeHunks(parseDiff(diff), files, parsers, mergeConfig({}))).values()];
}

test("Given a changed function, then the unchanged functions in the file that call it are listed as affected, and the others aren't", async () => {
  const file = (body: string) => [
    `export function parseDate(text: string) { ${body} }`,
    "export function formatRange(a: string, b: string) { return `${parseDate(a)} to ${parseDate(b)}`; }",
    "export function today() { return new Date(); }",
  ];
  const [hunk] = await analyze("src/dates.ts", file("return new Date(text);"), file("return new Date(text.trim());"));
  assert.deepEqual(hunk.affected, ["formatRange"]);
});

test("Given the caller is changed by another hunk of the file, then it isn't listed: the reviewer already reads it", async () => {
  const file = (parse: string, format: string) => [
    `export function parseDate(text: string) { ${parse} }`,
    "export const LIMIT = 3;",
    "export const OTHER = 4;",
    "export const THIRD = 5;",
    `export function formatRange(a: string) { ${format} }`,
    "export function label(a: string) { return String(parseDate(a)); }",
  ];
  const hunks = await analyze(
    "src/dates.ts",
    file("return new Date(text);", "return parseDate(a);"),
    file("return new Date(text.trim());", "return parseDate(a.trim());"),
  );
  assert.equal(hunks.length, 2);
  assert.deepEqual(hunks[0].affected, ["label"]);
  assert.deepEqual(hunks[1].affected, []);
});

test("Given a changed method, then only unchanged members of its own class are listed, not a same-named call elsewhere", async () => {
  const file = (total: string) => [
    "namespace Shop {",
    "  public class OrderService {",
    `    public decimal Total(Order o) { ${total} }`,
    "    public void Submit(Order o) { repo.Save(o, Total(o)); }",
    "    public void Print(Order o) { Console.WriteLine(o.Id); }",
    "  }",
    "  public class Report {",
    "    public decimal Sum(Cart cart) { return cart.Total(cart.Order); }",
    "  }",
    "}",
  ];
  const [hunk] = await analyze("Shop/OrderService.cs", file("return o.Lines.Sum(l => l.Price);"), file("return o.Lines.Sum(l => l.Price * l.Quantity);"));
  assert.deepEqual(hunk.affected, ["OrderService.Submit"]);
});

test("Given a changed top-level function used inside a class, then the method that uses it is listed, without its class", async () => {
  const file = (body: string) => [
    "def parse(text):",
    `    ${body}`,
    "class Importer:",
    "    def load(self, text):",
    "        return parse(text)",
    "    def name(self):",
    "        return 'importer'",
  ];
  const [hunk] = await analyze("app/importer.py", file("return text"), file("return text.strip()"));
  assert.deepEqual(hunk.affected, ["Importer.load"]);
});

test("Given a new file, then nothing is listed: it has no unchanged code", async () => {
  const [hunk] = await analyze("src/new.ts", [], ["export function a() { return b(); }", "export function b() { return 1; }"]);
  assert.deepEqual(hunk.affected, []);
});
