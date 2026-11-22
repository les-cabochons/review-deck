import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { before, test } from "node:test";
import { layoutDiagram } from "../diagram.js";
import { TERRAFORM_GRAMMAR } from "../grammar.js";
import { summarize } from "../blocks.js";
import { TerraformReader } from "../terraform.js";
import type { InfraBlock, InfraModule } from "../types.js";

const require = createRequire(import.meta.url);
let reader: TerraformReader;
before(async () => {
  reader = await TerraformReader.create(join(dirname(require.resolve(`${TERRAFORM_GRAMMAR.package}/package.json`)), TERRAFORM_GRAMMAR.file));
});

/** Diffs one `infra/main.tf` and returns its module. */
function diff(old: string | null, next: string | null): InfraModule {
  const modules = reader.diff([{ path: "infra/main.tf", old, new: next }]);
  assert.equal(modules.length, 1);
  return modules[0];
}

function block(module: InfraModule, address: string): InfraBlock {
  const found = module.blocks.find((b) => b.address === address);
  assert.ok(found, `no block ${address} in ${module.blocks.map((b) => b.address).join(", ")}`);
  return found;
}

const ACCOUNT = `
resource "azurerm_resource_group" "this" {
  name     = "rg-app"
  location = var.location
}

resource "azurerm_storage_account" "this" {
  name                     = "stapp"
  resource_group_name      = azurerm_resource_group.this.name
  account_tier             = "Standard"
  account_replication_type = "LRS"
}
`;

test("Given a block that is only realigned and commented, then nothing counts as changed", () => {
  const realigned = `
# The resource group everything lives in.
resource "azurerm_resource_group" "this" {
  name = "rg-app" # short
  location   =   var.location
}

resource "azurerm_storage_account" "this" {
  name = "stapp"
  resource_group_name = azurerm_resource_group.this.name
  account_tier = "Standard"
  account_replication_type = "LRS"
}
`;
  const module = diff(ACCOUNT, realigned);
  assert.deepEqual(module.blocks.filter((b) => b.status !== "same"), []);
  assert.deepEqual(summarize([module]), { destroy: 0, replace: 0, follows: 0, changed: 0, added: 0 });
});

test("Given an argument that updates in place, then the block is changed without a risk", () => {
  const module = diff(ACCOUNT, ACCOUNT.replace('"LRS"', '"GRS"'));
  const account = block(module, "azurerm_storage_account.this");
  assert.equal(account.status, "changed");
  assert.deepEqual(account.changes, [{ path: "account_replication_type", before: '"LRS"', after: '"GRS"' }]);
  assert.equal(account.risk, null);
  assert.deepEqual(summarize([module]), { destroy: 0, replace: 0, follows: 0, changed: 1, added: 0 });
});

test("Given a new literal for an argument the azurerm docs mark as forcing a new resource, then a replace is likely and names its source", () => {
  const module = diff(ACCOUNT, ACCOUNT.replace('"Standard"', '"Premium"'));
  const { risk } = block(module, "azurerm_storage_account.this");
  assert.equal(risk?.kind, "replace");
  assert.equal(risk?.certainty, "likely");
  assert.deepEqual(risk?.attributes, ["account_tier"]);
  assert.equal(risk?.docs?.provider, "azurerm");
  assert.match(risk?.reason ?? "", /azurerm \d+\.\d+\.\d+ documentation says changing `account_tier` forces a new resource\.$/);
});

test("Given a literal replaced by an expression in such an argument, then a replace is only possible, and the reason says the value may be the same", () => {
  const module = diff(ACCOUNT, ACCOUNT.replace('"stapp"', "var.storage_name"));
  const { risk } = block(module, "azurerm_storage_account.this");
  assert.equal(risk?.kind, "replace");
  assert.equal(risk?.certainty, "possible");
  assert.match(risk?.reason ?? "", /if its value stays the same, nothing is replaced/);
});

test("Given a change the docs make an exception for, then a replace is only possible, and the reason quotes the exception", () => {
  const account = (kind: string) => `
resource "azurerm_cognitive_account" "openai" {
  name     = "oai-app"
  kind     = "${kind}"
  sku_name = "S0"
}`;
  const { risk } = block(diff(account("OpenAI"), account("AIServices")), "azurerm_cognitive_account.openai");
  assert.equal(risk?.kind, "replace");
  assert.equal(risk?.certainty, "possible");
  assert.match(risk?.reason ?? "", /except when upgrading the Cognitive Service Account from `OpenAI` to `AIServices`/);
});

test("Given an argument of a nested block that forces a new resource, then it is found under its block's name", () => {
  const deployment = (name: string) => `
resource "azurerm_cognitive_deployment" "titles" {
  name                 = "titles"
  cognitive_account_id = azurerm_cognitive_account.openai.id
  model {
    format = "OpenAI"
    name   = "${name}"
  }
}`;
  const { risk } = block(diff(deployment("gpt-5-nano"), deployment("gpt-5-mini")), "azurerm_cognitive_deployment.titles");
  assert.equal(risk?.certainty, "likely");
  assert.deepEqual(risk?.attributes, ["model.name"]);
});

test("Given a resource that uses one likely to be replaced, then it may follow, and says through which attribute", () => {
  const withContainer = `${ACCOUNT}
resource "azurerm_storage_container" "data" {
  name               = "data"
  storage_account_id = azurerm_storage_account.this.id
}
`;
  const module = diff(withContainer, withContainer.replace('"Standard"', '"Premium"'));
  const container = block(module, "azurerm_storage_container.data");
  assert.equal(container.status, "same");
  assert.equal(container.risk?.kind, "follows");
  assert.equal(container.risk?.certainty, "possible");
  assert.equal(container.risk?.cause, "azurerm_storage_account.this");
  assert.match(container.risk?.reason ?? "", /through `storage_account_id`/);
  assert.deepEqual(summarize([module]), { destroy: 0, replace: 1, follows: 1, changed: 0, added: 0 });
});

test("Given a resource block deleted from the code, then a destroy is likely", () => {
  const module = diff(ACCOUNT, ACCOUNT.slice(0, ACCOUNT.indexOf('resource "azurerm_storage_account"')));
  const account = block(module, "azurerm_storage_account.this");
  assert.equal(account.status, "removed");
  assert.equal(account.risk?.kind, "destroy");
  assert.equal(account.risk?.certainty, "likely");
});

test("Given a resource renamed with a moved block, then neither side carries a risk, and both say why", () => {
  const renamed = `${ACCOUNT.replace('"azurerm_storage_account" "this"', '"azurerm_storage_account" "main"')}
moved {
  from = azurerm_storage_account.this
  to   = azurerm_storage_account.main
}
`;
  const module = diff(ACCOUNT, renamed);
  const old = block(module, "azurerm_storage_account.this");
  const next = block(module, "azurerm_storage_account.main");
  assert.equal(old.risk, null);
  assert.match(old.notes[0].text, /moved block renames it to `azurerm_storage_account.main`/);
  assert.equal(next.risk, null);
  assert.match(next.notes[0].text, /`azurerm_storage_account.this` renamed/);
});

test("Given a resource renamed without a moved block, then the old one is destroyed and the new one warns about the rename", () => {
  const module = diff(ACCOUNT, ACCOUNT.replace('"azurerm_storage_account" "this"', '"azurerm_storage_account" "main"'));
  assert.equal(block(module, "azurerm_storage_account.this").risk?.kind, "destroy");
  const next = block(module, "azurerm_storage_account.main");
  assert.equal(next.notes[0].level, "warn");
  assert.match(next.notes[0].text, /Same type as the removed `azurerm_storage_account.this`/);
});

test("Given count added to a resource, then there is no risk, and a note says Terraform moves the object itself", () => {
  const module = diff(ACCOUNT, ACCOUNT.replace('name                     = "stapp"', 'count                    = var.enabled ? 1 : 0\n  name                     = "stapp"'));
  const account = block(module, "azurerm_storage_account.this");
  assert.equal(account.risk, null);
  assert.equal(account.notes[0].level, "info");
  assert.match(account.notes[0].text, /moves the existing object to `azurerm_storage_account.this\[0\]`/);
});

test("Given for_each added to a resource without a moved block, then a replace is possible", () => {
  const module = diff(ACCOUNT, ACCOUNT.replace('name                     = "stapp"', 'for_each                 = var.accounts\n  name                     = "stapp"'));
  const { risk } = block(module, "azurerm_storage_account.this");
  assert.equal(risk?.kind, "replace");
  assert.equal(risk?.certainty, "possible");
  assert.deepEqual(risk?.attributes, ["for_each"]);
});

test("Given one key added to a map argument, then that key alone is the change, and the edge to what it references is added", () => {
  const app = (settings: string) => `
resource "random_password" "api_key" {
  length = 40
}

resource "azurerm_windows_function_app" "this" {
  name = "func-app"
  app_settings = {
    WEBSITE_RUN_FROM_PACKAGE = "1"${settings}
  }
}`;
  const module = diff(app(""), app("\n    API_KEY = random_password.api_key.result"));
  assert.deepEqual(block(module, "azurerm_windows_function_app.this").changes, [{ path: "app_settings.API_KEY", before: null, after: "random_password.api_key.result" }]);
  assert.deepEqual(module.edges, [{ from: "random_password.api_key", to: "azurerm_windows_function_app.this", status: "added", via: ["app_settings.API_KEY"] }]);
});

test("Given a reference to a resource declared in a file the pull request doesn't change, then it shows as an unchanged neighbour without a file", () => {
  const module = diff(null, `
resource "azurerm_storage_account" "this" {
  name                = "stapp"
  resource_group_name = azurerm_resource_group.shared.name
  tags                = { for key, some_value in var.tags : key => some_value.name }
}`);
  const group = block(module, "azurerm_resource_group.shared");
  assert.equal(group.status, "same");
  assert.equal(group.file, null);
  // `some_value` is bound by the for expression: not a resource called some_value.name.
  assert.deepEqual(module.blocks.map((b) => b.address).sort(), ["azurerm_resource_group.shared", "azurerm_storage_account.this"]);
});

test("Given changed files in two directories, then each directory is its own module, and addresses don't mix", () => {
  const group = (location: string) => `resource "azurerm_resource_group" "this" {\n  name = "rg"\n  location = "${location}"\n}\n`;
  const modules = reader.diff([
    { path: "infra/prod/main.tf", old: group("eastus"), new: group("westus") },
    { path: "infra/dev/main.tf", old: group("eastus"), new: group("eastus") },
    { path: "README.md", old: "a", new: "b" },
  ]);
  assert.deepEqual(modules.map((m) => m.dir), ["infra/dev", "infra/prod"]);
  assert.equal(block(modules[0], "azurerm_resource_group.this").status, "same");
  assert.equal(block(modules[1], "azurerm_resource_group.this").risk?.kind, "replace");
});

test("Given only a variable's description changed, then it is listed as description only and kept out of the diagram", () => {
  const variable = (description: string) => `variable "location" {\n  type = string\n  description = "${description}"\n}\n`;
  const module = diff(variable("Region"), variable("Azure region"));
  assert.equal(block(module, "var.location").docsOnly, true);
  assert.equal(layoutDiagram(module, { width: 700, height: 400 }), null);
});

test("Given a changed resource, then the diagram draws it with what the change involves, and leaves unrelated neighbours out", () => {
  const before = `${ACCOUNT}
resource "random_password" "key" {
  length = 40
}
`;
  const after = before.replace('account_replication_type = "LRS"', 'account_replication_type = "LRS"\n  tags = { key = random_password.key.result }');
  const diagram = layoutDiagram(diff(before, after), { width: 700, height: 400 });
  assert.ok(diagram);
  // The resource group is used through an unchanged line, so it adds nothing to this change.
  assert.deepEqual(diagram.nodes.map((n) => n.block.address).sort(), ["azurerm_storage_account.this", "random_password.key"]);
  assert.equal(diagram.nodes.find((n) => n.block.address === "azurerm_storage_account.this")?.title, "Storage account");
  assert.deepEqual(diagram.edges.map((e) => [e.edge.status, e.label?.text]), [["added", "tags.key"]]);
  for (const node of diagram.nodes) assert.ok(node.x >= 0 && node.y >= 0 && node.x + node.width <= diagram.width && node.y + node.height <= diagram.height);
});

test("Given a reference that only gains [0] because its target gained count, then that alone is no replace", () => {
  const assignment = (count: string, index: string) => `
resource "azurerm_cognitive_account" "openai" {${count}
  name = "oai-app"
}

resource "azurerm_role_assignment" "titles" {
  scope                = azurerm_cognitive_account.openai${index}.id
  role_definition_name = "Cognitive Services User"
}`;
  const module = diff(assignment("", ""), assignment("\n  count = var.enabled ? 1 : 0", "[0]"));
  const titles = block(module, "azurerm_role_assignment.titles");
  assert.equal(titles.status, "changed");
  assert.equal(titles.risk, null);
});

test("Given a resource added by the same pull request that uses one likely to be replaced, then it is just added", () => {
  const queue = `
resource "azurerm_storage_queue" "jobs" {
  name               = "jobs"
  storage_account_id = azurerm_storage_account.this.id
}
`;
  const module = diff(ACCOUNT, ACCOUNT.replace('"Standard"', '"Premium"') + queue);
  assert.equal(block(module, "azurerm_storage_account.this").risk?.kind, "replace");
  const added = block(module, "azurerm_storage_queue.jobs");
  assert.equal(added.status, "added");
  assert.equal(added.risk, null);
});

test("Renames preserve each side's Terraform path and module", () => {
  const [source] = reader.diff([{ path: "infra/main.tf.disabled", oldPath: "infra/main.tf", old: ACCOUNT, new: ACCOUNT }]);
  assert.equal(source.dir, "infra");
  const removed = block(source, "azurerm_storage_account.this");
  assert.equal(removed.file, "infra/main.tf");
  assert.equal(removed.risk?.kind, "destroy");

  const [destination, origin] = reader.diff([{ path: "dev/main.tf", oldPath: "prod/main.tf", old: ACCOUNT, new: ACCOUNT }]);
  assert.equal(destination.dir, "dev");
  assert.equal(block(destination, "azurerm_storage_account.this").status, "added");
  assert.equal(origin.dir, "prod");
  assert.equal(block(origin, "azurerm_storage_account.this").status, "removed");

  const [sameDir] = reader.diff([{ path: "infra/renamed.tofu", oldPath: "infra/main.tf", old: ACCOUNT, new: ACCOUNT }]);
  assert.equal(block(sameDir, "azurerm_storage_account.this").status, "same");
});

test("Changes to literal string and heredoc whitespace are visible", () => {
  const before = [
    'resource "terraform_data" "this" {',
    '  input = ["  two  spaces ", "  key ${var.name} ", <<EOF',
    'line one',
    '',
    'line two',
    'EOF',
    '  ]',
    '}',
  ].join("\n");
  for (const [oldText, newText] of [["two  spaces", "two spaces"], ["  key ", " key "], ["one\n\nline", "one\nline"]]) {
    const module = diff(before, before.replace(oldText, newText));
    assert.deepEqual(module.parseErrors, []);
    const [{ before: oldValue, after: newValue }] = block(module, "terraform_data.this").changes;
    assert.ok(oldValue?.includes(oldText));
    assert.ok(newValue?.includes(newText));
  }
});

test("For collections and computed map keys keep their resource references", () => {
  const module = diff(null, `
resource "terraform_data" "this" {
  input = {
    (terraform_data.keys.output) = [for terraform_data in terraform_data.collection.output : terraform_data.value]
  }
}`);
  assert.deepEqual(module.parseErrors, []);
  assert.deepEqual(module.edges.map((edge) => edge.from).sort(), ["terraform_data.collection", "terraform_data.keys"]);
});

test("Indexing a local or changing an existing resource instance can change a force-new value", () => {
  const assignment = (scope: string) => `
resource "azurerm_role_assignment" "titles" {
  scope = ${scope}
  role_definition_name = "Reader"
}`;
  for (const [before, after] of [
    ["local.scope", "local.scope[0]"],
    ["azurerm_cognitive_account.openai[1].id", "azurerm_cognitive_account.openai[0].id"],
    ["azurerm_cognitive_account.openai.id", "azurerm_cognitive_account.openai[0].id"],
  ]) {
    const { risk } = block(diff(assignment(before), assignment(after)), "azurerm_role_assignment.titles");
    assert.equal(risk?.kind, "replace");
    assert.equal(risk?.certainty, "possible");
  }
});

test("Moving one instance of a removed resource leaves a possible destroy for its siblings", () => {
  const module = diff(ACCOUNT.replace('name                     = "stapp"', 'count = 2\n  name = "stapp"'), `
moved {
  from = azurerm_storage_account.this[0]
  to = azurerm_storage_account.main
}`);
  const { risk } = block(module, "azurerm_storage_account.this");
  assert.equal(risk?.kind, "destroy");
  assert.equal(risk?.certainty, "possible");
  assert.match(risk.reason, /Other instances may be destroyed/);
});

test("A moved resource can still be replaced when a force-new argument changes", () => {
  const renamed = ACCOUNT.replace('"azurerm_storage_account" "this"', '"azurerm_storage_account" "main"').replace('"Standard"', '"Premium"');
  const module = diff(ACCOUNT, `${renamed}
moved {
  from = azurerm_storage_account.this
  to = azurerm_storage_account.main
}
`);
  assert.equal(block(module, "azurerm_storage_account.this").risk, null);
  const moved = block(module, "azurerm_storage_account.main");
  assert.equal(moved.risk?.kind, "replace");
  assert.deepEqual(moved.changes, [{ path: "account_tier", before: '"Standard"', after: '"Premium"' }]);
});
