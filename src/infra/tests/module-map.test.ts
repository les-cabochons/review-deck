import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { before, test } from "node:test";
import { TERRAFORM_GRAMMAR } from "../grammar.js";
import { moduleMap, showsModuleMap } from "../modules.js";
import { TerraformReader } from "../terraform.js";

const require = createRequire(import.meta.url);
let reader: TerraformReader;
before(async () => {
  reader = await TerraformReader.create(join(dirname(require.resolve(`${TERRAFORM_GRAMMAR.package}/package.json`)), TERRAFORM_GRAMMAR.file));
});

const ROOT_BEFORE = `
module "storage" {
  source = "../../modules/storage"
}
module "network" {
  source = "../../modules/network"
}
module "naming" {
  source  = "Azure/naming/azurerm"
  version = "0.4.1"
}
module "function_app" {
  source               = "../../modules/function-app"
  storage_account_name = module.storage.account_name
  subnet_id            = module.network.subnet_id
}
output "hostname" {
  value = module.function_app.hostname
}
`;

const ROOT_AFTER = ROOT_BEFORE.replace(
  "subnet_id            = module.network.subnet_id",
  "subnet_id            = module.network.subnet_id\n  queue_name           = module.storage.queue_name",
);

test("links the modules a pull request changes through the folder that calls them", () => {
  const modules = reader.diff([
    { path: "envs/prod/main.tf", old: ROOT_BEFORE, new: ROOT_AFTER },
    { path: "modules/storage/outputs.tf", old: null, new: 'output "queue_name" {\n  value = "resize"\n}\n' },
    { path: "modules/function-app/variables.tf", old: null, new: 'variable "queue_name" {\n  type = string\n}\n' },
  ]);
  assert.ok(showsModuleMap(modules));
  const map = moduleMap(modules);

  assert.deepEqual(
    map.nodes.map((n) => [n.id, n.kind]),
    [
      ["envs/prod", "changed"],
      ["modules/function-app", "changed"],
      ["modules/storage", "changed"],
      ["remote:Azure/naming/azurerm", "remote"],
      ["modules/network", "neighbour"],
    ],
  );
  const links = Object.fromEntries(map.links.map((l) => [`${l.from} > ${l.to}`, [l.status, l.names.join(",")]]));
  assert.deepEqual(links, {
    // The new input reads a new output: the reference is new, the pair isn't. The new output comes first.
    "modules/storage > modules/function-app": ["touched", "queue_name,account_name"],
    "modules/network > modules/function-app": ["same", "subnet_id"],
    "modules/function-app > envs/prod": ["same", "hostname"],
    // Called, and nothing read from it: it still hangs off its caller.
    "remote:Azure/naming/azurerm > envs/prod": ["same", ""],
  });
  assert.deepEqual(
    map.calls.map((c) => `${c.caller} calls ${c.callee}`),
    ["envs/prod calls modules/storage", "envs/prod calls modules/network", "envs/prod calls remote:Azure/naming/azurerm", "envs/prod calls modules/function-app"],
  );
});

test("one changed folder draws no module map", () => {
  assert.equal(showsModuleMap(reader.diff([{ path: "infra/main.tf", old: null, new: ROOT_AFTER }])), false);
});

test("a module declared in a file the pull request doesn't change is known by its name alone", () => {
  const modules = reader.diff([
    { path: "envs/prod/app.tf", old: 'output "url" {\n  value = module.web.url\n}\n', new: 'output "url" {\n  value = module.web.public_url\n}\n' },
    { path: "modules/web/outputs.tf", old: null, new: 'output "public_url" {\n  value = "x"\n}\n' },
  ]);
  const map = moduleMap(modules);
  assert.deepEqual(
    map.nodes.map((n) => [n.label, n.kind]),
    [
      ["envs/prod", "changed"],
      ["modules/web", "changed"],
      ["module.web", "unknown"],
    ],
  );
  // The line now reads public_url and read url before: both are the change.
  assert.deepEqual(map.links, [{ from: "call:envs/prod:web", to: "envs/prod", names: ["public_url", "url"], status: "touched" }]);
});

test("an output a pull request stops reading still names its arrow", () => {
  const caller = (outputs: string) => `module "storage" {\n  source = "../../modules/storage"\n}\nmodule "app" {\n  source = "../../modules/app"\n${outputs}}\n`;
  const modules = reader.diff([
    { path: "envs/prod/main.tf", old: caller("  queue = module.storage.queue_name\n  account = module.storage.account_name\n"), new: caller("  account = module.storage.account_name\n") },
    { path: "modules/app/variables.tf", old: 'variable "queue" {}\n', new: null },
  ]);
  const link = moduleMap(modules).links.find((l) => l.from === "modules/storage" && l.to === "modules/app");
  assert.deepEqual([link?.status, link?.names], ["touched", ["queue_name", "account_name"]]);
});

test("an output passed through a local still links the module that gives it to the module that reads it", () => {
  const storage = 'module "storage" {\n  source = "../../modules/storage"\n}\n';
  const modules = reader.diff([
    {
      path: "envs/prod/main.tf",
      old: `${storage}module "app" {\n  source = "../../modules/app"\n  id     = module.storage.id\n}\n`,
      new: `${storage}locals {\n  id = module.storage.id\n}\nmodule "app" {\n  source = "../../modules/app"\n  id     = local.id\n}\n`,
    },
    { path: "modules/app/variables.tf", old: 'variable "id" {}\n', new: 'variable "id" {\n  type = string\n}\n' },
  ]);
  const links = moduleMap(modules).links.map((l) => [`${l.from} > ${l.to}`, l.status, l.names.join(",")]);
  // The reference moved into a local: still storage to app, and touched, not removed.
  assert.deepEqual(links, [
    ["modules/storage > modules/app", "touched", "id"],
    ["modules/app > envs/prod", "same", ""],
  ]);
});
