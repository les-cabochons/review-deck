/**
 * Builds a synthetic huge PR for checking that the review page stays responsive.
 *
 *   npx tsx scripts/build-huge-mock.ts [copies=30]
 *
 * Copies every file of the t3code-17901 snapshot `copies` times under `/huge-<n>/` (copy 0 keeps the
 * real paths and threads), writes extension/dev-data/t3code-huge.json and adds it to pr-list.json
 * as !99999. Run `npm run ext:mock` first.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PrListSnapshot } from "../extension/src/data/listSnapshot.js";
import type { PrSnapshot } from "../extension/src/data/snapshot.js";
import { ROOT } from "../src/node/fixtures.js";

const ID = 99999;
const copies = Number(process.argv[2] ?? 30);
const data = join(ROOT, "extension", "dev-data");
const base = JSON.parse(readFileSync(join(data, "t3code-17901.json"), "utf8")) as PrSnapshot;

const copyPath = (path: string, n: number) => (n === 0 ? path : `/huge-${n}${path}`);
const trees: PrSnapshot["trees"] = {};
for (const [iteration, tree] of Object.entries(base.trees)) {
  trees[iteration] = {};
  for (let n = 0; n < copies; n++) for (const [path, blob] of Object.entries(tree)) trees[iteration][copyPath(path, n)] = blob;
}
const renames: PrSnapshot["renames"] = {};
for (let n = 0; n < copies; n++) for (const [to, from] of Object.entries(base.renames)) renames[copyPath(to, n)] = copyPath(from, n);

const huge: PrSnapshot = {
  ...base,
  source: { ...base.source, note: `Synthetic: ${copies} copies of t3code-17901's files, for performance checks.` },
  pullRequest: { ...base.pullRequest, pullRequestId: ID, title: `[perf] ${copies}× ${base.pullRequest.title}` },
  trees,
  renames,
};
writeFileSync(join(data, "t3code-huge.json"), JSON.stringify(huge));

const listPath = join(data, "pr-list.json");
const list = JSON.parse(readFileSync(listPath, "utf8")) as PrListSnapshot;
const template = list.pullRequests.find((p) => p.snapshot === "t3code-17901")!;
const files = Object.keys(trees[String(base.iterations.at(-1)!.id)]).length;
list.pullRequests = [
  { ...template, pullRequestId: ID, title: huge.pullRequest.title, snapshot: "t3code-huge", size: { files, adds: template.size.adds * copies, dels: template.size.dels * copies } },
  ...list.pullRequests.filter((p) => p.pullRequestId !== ID),
];
writeFileSync(listPath, JSON.stringify(list, null, 1));
console.log(`t3code-huge.json: ${files} files (${copies} copies) as !${ID}`);
