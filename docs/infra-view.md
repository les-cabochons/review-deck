# The Infra view

A comparison that changes Terraform or OpenTofu files (`.tf`, `.tofu`) gets an **Infra** tab and an **Infrastructure** card in Overview. They show which resources the pull request adds, changes or removes, what uses what, and what may be destroyed or replaced.

Everything is read in the browser from the files the review already holds. Review Deck never runs `terraform`, reads no state or plan, and sends nothing anywhere. A pull request without Terraform files loads none of this.

## What it reads

`src/infra` parses both sides of every changed Terraform file with [tree-sitter-hcl](https://github.com/tree-sitter-grammars/tree-sitter-hcl) and compares their blocks by address (`azurerm_storage_account.uploads`, `module.network`, `var.location`). The address is the same on both sides, so a block is added, removed, or changed in the attributes listed.

- An attribute is compared as its expression's text, without comments or alignment. Realigning a block changes nothing.
- A nested block's attributes carry its name (`site_config.application_stack.node_version`). An object literal is compared key by key, so one added app setting is one change (`app_settings.API_KEY`).
- References between blocks (`azurerm_resource_group.this.name`) are the diagram's arrows. An arrow is coloured when the reference was added, removed, or sits on a changed line.
- Each directory is one module, as for Terraform. Two directories with the same addresses don't mix.

The diagram draws the changed resources, data sources and modules, plus what the change involves around them: what a changed block uses through a changed line, what uses a changed block, and the changed variables, locals and outputs wired to them (`src/infra/diagram.ts`, laid out with [dagre](https://github.com/dagrejs/dagre)).

## What may be destroyed or replaced

The code alone can't say what the provider will do, so a destroy or a replace is never shown as a fact. Each reading has a certainty and a reason, shown as is, and the tag **from code**.

| Reading | When | Certainty |
| --- | --- | --- |
| **Destroy** | A `resource` or `module` block is gone, and no `moved` block or `removed` block with `destroy = false` covers it. | likely |
| **Replace** | An argument changed that the provider's documentation marks "forces a new resource". | likely if a literal value changed. possible if only an expression changed (its value may be the same), if the argument is newly set or unset, or if the documentation states an exception, which the reason then quotes. |
| **Replace** | `for_each` was added or removed without a `moved` block. | possible |
| **May follow** | A resource uses one that may be destroyed or replaced. One hop only. A resource the pull request adds is left out. | possible |

Notes cover what isn't a risk of its own: `count` added (Terraform moves the object to `[0]` itself), `count` removed, `prevent_destroy` dropped, a rename without a `moved` block, a provider version constraint, a variable's default.

### The list of arguments that force a new resource

`src/infra/lib/forceNew/azurerm.json` is generated from the azurerm provider's documentation, where such an argument reads "Changing this forces a new resource to be created". The provider's schema would be the exact source, but `terraform providers schema -json` doesn't export it.

```sh
git clone --depth 1 --filter=blob:none --sparse https://github.com/hashicorp/terraform-provider-azurerm.git
git -C terraform-provider-azurerm sparse-checkout set website/docs/r
npx tsx scripts/build-force-new.ts terraform-provider-azurerm 5.14.0
```

The current list is from 5.14.0: 1,100 resources and 5,339 arguments. The reason shown for a replace names that version. Other providers have no list, so their replaces aren't flagged. To add one, generate its list the same way and add it to `FORCE_NEW` in `src/infra/lib/risk.ts`.

## What it can't know

The tab's **How this works** says the same to the reader.

- **What the provider does.** Whether a change updates in place, what a default resolves to, and what a different provider version does are only in `terraform plan`.
- **Files the pull request doesn't change.** They aren't read. A resource they declare shows as a grey neighbour, known by its address alone. A resource in them that uses a changed one isn't shown, so "may follow" misses it.
- **Values.** Variables, `tfvars`, the number of instances `count` and `for_each` make, and what is inside a called module are not evaluated.
- **The docs' gaps.** The list is as good as the documentation. The docs name a nested block without its parents, so two blocks of the same name in one resource share their entries.

A pipeline that publishes its plan could turn these readings into facts. Nothing reads a plan today.

## Code

| Path | What's there |
| --- | --- |
| `src/infra/terraform.ts` | `TerraformReader`: the changed files in, one `InfraModule` per directory out. |
| `src/infra/blocks.ts` | Small readings of a block that need neither the parser nor the layout: what counts as changed, its rank by risk, its name. |
| `src/infra/diagram.ts` | What the diagram draws, and where. |
| `src/infra/lib/` | The HCL reader, the diff and the risk rules. |
| `extension/src/review/infra.ts` | Loads the parser on first use and reads a comparison's files. |
| `extension/src/ui/infra/` | The card, the tab and the diagram. |

## Checks

- `src/infra/tests/terraform.test.ts` covers the diff and every risk rule against real HCL (`npm test`).
- `extension/tests/infra.browser.js` opens demo pull request !472 in the write harness and checks the card, the tab, the order of the list, the sources shown, and that a pull request without Terraform gets neither (`npm run ext:demo`, `npm run ext:test:browser`, with `npm run ext:dev` running).
- `extension/tests/manifest.test.ts` checks the Terraform grammar is packaged.

To see it locally, run `npm run ext:demo` and `npm run ext:dev`, then open pull request !472. Its files are in `fixtures/demo/infra-pr`.
