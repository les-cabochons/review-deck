/**
 * Builds the list of azurerm arguments that force a new resource, from the provider's own documentation.
 *
 * The provider's resource pages mark such an argument with "Changing this forces a new resource to be created".
 * This script fetches the pages of a release, keeps those arguments, and writes
 * src/infra/lib/forceNew/azurerm.json, which the Infra view uses to say "replace" (src/infra/lib/risk.ts). The
 * provider's schema would be the exact source, but `terraform providers schema -json` doesn't export which
 * arguments force a new resource.
 *
 *   npx tsx scripts/build-force-new.ts            # the latest stable release (also `just force-new-list`)
 *   npx tsx scripts/build-force-new.ts 5.14.0     # that release
 *
 * It needs git and network access. The pages are kept in .cache/providers, read as text, and nothing in the
 * provider's repository is executed. .github/workflows/force-new-list.yml runs it every week and opens a pull
 * request when the list changes.
 *
 * Keys are the argument's name, or `<block>.<argument>` for an argument of a nested block. The docs name a block
 * without its parents, so two blocks of the same name in one resource share their entries. The value is "" for a
 * plain "forces a new resource", or what the sentence adds after it (an exception, mostly), which the page quotes.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const REPOSITORY = "https://github.com/hashicorp/terraform-provider-azurerm.git";
const DOCS_PATH = "website/docs/r";
const OUT = join(ROOT, "src", "infra", "lib", "forceNew", "azurerm.json");
/**
 * A new list with fewer arguments than this share of the current one is refused. The docs changing their wording
 * would otherwise empty the list without an error, and the Infra view would stop flagging replaces.
 */
const MIN_SHARE_OF_CURRENT = 0.9;

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

/** The highest `vX.Y.Z` tag: pre-releases have a suffix and are left out. */
function latestRelease(): string {
  const versions = git("ls-remote", "--tags", "--refs", REPOSITORY, "v*")
    .split("\n")
    .map((line) => /refs\/tags\/v(\d+)\.(\d+)\.(\d+)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const latest = versions.at(-1);
  if (!latest) throw new Error(`No release tag found in ${REPOSITORY}`);
  return latest.join(".");
}

/** The resource pages of release `version`, fetched once: a shallow, sparse clone of the tag, without the code. */
function fetchDocs(version: string): string {
  const checkout = join(ROOT, ".cache", "providers", `terraform-provider-azurerm-${version}`);
  const docs = join(checkout, DOCS_PATH);
  if (existsSync(docs)) return docs;
  // What a clone that failed halfway left behind.
  rmSync(checkout, { recursive: true, force: true });
  mkdirSync(join(ROOT, ".cache", "providers"), { recursive: true });
  git("-c", "advice.detachedHead=false", "clone", "--quiet", "--depth", "1", "--branch", `v${version}`, "--filter=blob:none", "--sparse", REPOSITORY, checkout);
  git("-C", checkout, "sparse-checkout", "set", DOCS_PATH);
  return docs;
}

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

const requested = process.argv[2];
if (requested !== undefined && !/^\d+\.\d+\.\d+$/.test(requested)) {
  console.error("usage: tsx scripts/build-force-new.ts [provider version, e.g. 5.14.0]");
  process.exit(1);
}
const version = requested ?? latestRelease();
const docs = fetchDocs(version);

const resources: Record<string, Record<string, string>> = {};
let pages = 0;
let entries = 0;
let qualified = 0;
for (const file of readdirSync(docs).filter((f) => f.endsWith(".markdown")).sort()) {
  pages++;
  const found = forceNewOf(readFileSync(join(docs, file), "utf8"));
  const keys = Object.keys(found).sort();
  if (keys.length === 0) continue;
  resources[`azurerm_${file.replace(/\.html\.markdown$|\.markdown$/, "")}`] = Object.fromEntries(keys.map((k) => [k, found[k]]));
  entries += keys.length;
  qualified += keys.filter((k) => found[k] !== "").length;
}

const current = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, "utf8")) as { version: string; resources: Record<string, Record<string, string>> }) : null;
const currentEntries = current ? Object.values(current.resources).reduce((n, r) => n + Object.keys(r).length, 0) : 0;
if (entries < currentEntries * MIN_SHARE_OF_CURRENT) {
  console.error(
    `Refusing to write the list: ${version} gives ${entries} arguments, and the current list (${current?.version}) has ${currentEntries}. ` +
      "The documentation's wording or layout has probably changed: check FORCES_NEW, ARGUMENT and BLOCK_HEADER against a resource page.",
  );
  process.exit(1);
}

const json = JSON.stringify({ provider: "azurerm", version, source: `${DOCS_PATH} in hashicorp/terraform-provider-azurerm at v${version}`, resources });
writeFileSync(OUT, `${json}\n`);
console.log(`azurerm ${version}: ${pages} pages, ${Object.keys(resources).length} resources with ${entries} arguments (${qualified} with a condition), ${(json.length / 1024).toFixed(0)} KB.`);

// What changed since the list in the repository, for whoever reviews the update (the workflow puts it in its pull request).
if (current) {
  const flat = (list: Record<string, Record<string, string>>) => new Map(Object.entries(list).flatMap(([type, known]) => Object.entries(known).map(([argument, condition]) => [`${type}.${argument}`, condition] as const)));
  const before = flat(current.resources);
  const after = flat(resources);
  const added = [...after.keys()].filter((key) => !before.has(key));
  const removed = [...before.keys()].filter((key) => !after.has(key));
  const reworded = [...after.keys()].filter((key) => before.has(key) && before.get(key) !== after.get(key));
  const some = (keys: string[]) => (keys.length === 0 ? "" : `: ${keys.slice(0, 20).join(", ")}${keys.length > 20 ? ` and ${keys.length - 20} more` : ""}`);
  console.log(`Since ${current.version} (${currentEntries} arguments):`);
  console.log(`- ${added.length} now force a new resource${some(added)}`);
  console.log(`- ${removed.length} no longer do${some(removed)}`);
  console.log(`- ${reworded.length} have a new condition${some(reworded)}`);
}
