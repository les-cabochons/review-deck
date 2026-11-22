/**
 * Builds the list of azurerm arguments that force a new resource, from the provider's own documentation.
 *
 * The provider's resource pages mark such an argument with "Changing this forces a new resource to be created".
 * This script reads every page, keeps those arguments, and writes src/infra/lib/forceNew/azurerm.json, which the
 * Infra view uses to say "replace likely" (src/infra/lib/risk.ts). The provider's schema would be the exact source,
 * but `terraform providers schema -json` doesn't export which arguments force a new resource.
 *
 *   git clone --depth 1 --filter=blob:none --sparse https://github.com/hashicorp/terraform-provider-azurerm.git
 *   git -C terraform-provider-azurerm sparse-checkout set website/docs/r
 *   npx tsx scripts/build-force-new.ts terraform-provider-azurerm <version, e.g. 5.14.0>
 *
 * Keys are the argument's name, or `<block>.<argument>` for an argument of a nested block. The docs name a block
 * without its parents, so two blocks of the same name in one resource share their entries. The value is "" for a
 * plain "forces a new resource", or what the sentence adds after it (an exception, mostly), which the page quotes.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [checkout, version] = process.argv.slice(2);
if (!checkout || !version) {
  console.error("usage: tsx scripts/build-force-new.ts <terraform-provider-azurerm checkout> <provider version>");
  process.exit(1);
}

const DOCS = join(checkout, "website", "docs", "r");
const OUT = resolve(import.meta.dirname, "..", "src", "infra", "lib", "forceNew", "azurerm.json");

/** "A `sku` block supports the following:", and the docs' other spellings of it. */
const BLOCK_HEADER = /^(?:An?|The|Each|One or more) `([a-z0-9_]+)` blocks? (?:supports?|contains?|as defined|is documented|accepts)/i;
/** "* `name` - (Required) …" */
const ARGUMENT = /^\s*[*-] `([a-z0-9_]+)`\s+-\s+(.*)$/;
/** "forces a new resource to be created", "forces a new Resource Group to be created", or a bare "forces a new resource". */
const FORCES_NEW = /forces? a new (?:[a-z0-9 ]*?to be created|resource)/i;

function forceNewOf(markdown: string): Record<string, string> {
  const start = markdown.search(/^##+ Arguments? Reference/im);
  if (start < 0) return {};
  // The exported attributes and the timeouts follow the arguments.
  const end = markdown.slice(start + 1).search(/^##+ (?:Attributes? Reference|Timeouts|Import)/im);
  const lines = markdown.slice(start, end < 0 ? undefined : start + 1 + end).split("\n");

  const found: Record<string, string> = {};
  let block: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const header = BLOCK_HEADER.exec(lines[i]);
    if (header) {
      block = header[1];
      continue;
    }
    const argument = ARGUMENT.exec(lines[i]);
    if (!argument) continue;
    // An argument's text runs to the next blank line. Notes (-> and ~>) are paragraphs of their own, and often
    // quote another argument's rule, so they are left out.
    let text = argument[2];
    while (i + 1 < lines.length && lines[i + 1].trim() !== "" && !ARGUMENT.test(lines[i + 1])) text += ` ${lines[++i].trim()}`;
    const match = FORCES_NEW.exec(text);
    if (!match) continue;
    found[block ? `${block}.${argument[1]}` : argument[1]] = qualifier(text.slice(match.index + match[0].length));
  }
  return found;
}

/** What the sentence says after "…to be created": an exception or a condition. Empty when it just ends. */
function qualifier(rest: string): string {
  const sentence = /^[^.]*(?:\.(?=\S)[^.]*)*/.exec(rest)?.[0].trim() ?? "";
  // Markdown links read badly in a tooltip; keep their text.
  return sentence.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s+/g, " ");
}

const resources: Record<string, Record<string, string>> = {};
let pages = 0;
let entries = 0;
let qualified = 0;
for (const file of readdirSync(DOCS).filter((f) => f.endsWith(".markdown")).sort()) {
  pages++;
  const found = forceNewOf(readFileSync(join(DOCS, file), "utf8"));
  const keys = Object.keys(found).sort();
  if (keys.length === 0) continue;
  resources[`azurerm_${file.replace(/\.html\.markdown$|\.markdown$/, "")}`] = Object.fromEntries(keys.map((k) => [k, found[k]]));
  entries += keys.length;
  qualified += keys.filter((k) => found[k] !== "").length;
}

const json = JSON.stringify({ provider: "azurerm", version, source: "website/docs/r in hashicorp/terraform-provider-azurerm", resources });
writeFileSync(OUT, `${json}\n`);
console.log(`${pages} pages, ${Object.keys(resources).length} resources with ${entries} arguments (${qualified} with a condition), ${(json.length / 1024).toFixed(0)} KB -> ${OUT}`);
