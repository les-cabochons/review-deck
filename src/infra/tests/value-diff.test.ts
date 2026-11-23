import assert from "node:assert/strict";
import { test } from "node:test";
import { valueDiff } from "../valueDiff.js";

const show = (parts: { kind: string; text: string }[]) => parts.map((p) => (p.kind === "changed" ? `[${p.text}]` : p.text)).join("");

test("Given a value where one word changed, then only that word is marked on each side", () => {
  const { before, after } = valueDiff('"Standard"', '"Premium"');
  assert.equal(show(before), '"[Standard]"');
  assert.equal(show(after), '"[Premium]"');
});

test("Given a long value changed in the middle, then each side keeps the change and some context, and cuts the rest", () => {
  const head = `merge({ "KeyVaultUrl" = azurerm_key_vault.this.vault_uri, ${"x".repeat(100)}`;
  const tail = `${"y".repeat(100)} })`;
  const { before, after } = valueDiff(`${head} "BaseUrl" = var.devops_base_url ${tail}`, `${head} "BaseUrl" = var.devops_api_url ${tail}`);
  assert.match(show(before), /^….{40}\[devops_base_url\].{40}…$/s);
  assert.match(show(after), /^….{40}\[devops_api_url\].{40}…$/s);
});

test("Given a key added to a value, then the other side shows nothing marked", () => {
  const { before, after } = valueDiff("[a, b]", "[a, b, c]");
  assert.equal(before.some((p) => p.kind === "changed"), false);
  assert.equal(show(after), "[a, b[, c]]");
});
