import type { AttributeChange, InfraBlock, InfraModule, Risk } from "../types.js";
import { attributeChanges, type BlockSides, type ModuleDiff } from "./diff.js";
import azurerm from "./forceNew/azurerm.json" with { type: "json" };

// What applying a change may do beyond an update in place, read from the code alone. Three rules give a Risk:
//   destroy: a resource or module block is gone, and no `moved` or `removed` block says otherwise.
//   replace: an argument the provider's documentation marks "forces a new resource" changed, or `for_each` came or went.
//   follows: a resource uses one that may be destroyed or replaced.
// Every one is a reading of the code. `certainty` and `reason` say how far it can be trusted, and the page shows both.

/**
 * A provider's arguments that force a new resource, generated from its documentation (scripts/build-force-new.ts).
 * Per resource type: the argument (`name`) or block argument (`sku.name`), and what the docs add to the rule ("" if nothing).
 */
interface ForceNewList {
  provider: string;
  version: string;
  resources: Record<string, Record<string, string>>;
}

const FORCE_NEW: ForceNewList[] = [azurerm as ForceNewList];

/** The documentation the replace rule rests on, for the page to name. */
export const FORCE_NEW_SOURCES = FORCE_NEW.map(({ provider, version }) => ({ provider, version }));

interface ForceNewHit {
  change: AttributeChange;
  /** What the docs add after "forces a new resource": an exception ("except when…", "unless…") or a consequence. */
  condition: string;
  list: ForceNewList;
}

/**
 * The docs name a nested block without its parents, so `site_config.application_stack.node_version` is looked up
 * as `site_config`, `site_config.application_stack` and `application_stack.node_version`. An index is not part of
 * the name.
 */
function forceNew(type: string, change: AttributeChange): ForceNewHit | null {
  const segments = change.path.replace(/\[\d+\]/g, "").split(".");
  for (const list of FORCE_NEW) {
    const known = list.resources[type];
    if (!known) continue;
    for (let i = 0; i < segments.length; i++) {
      const condition = known[i === 0 ? segments[0] : `${segments[i - 1]}.${segments[i]}`];
      if (condition !== undefined) return { change, condition, list };
    }
  }
  return null;
}

/** A quoted string without interpolation, a number, a boolean or null: its text is its value. */
const isLiteral = (text: string | null) => text !== null && /^(?:"(?:[^"\\$%]|\\.|[$%](?!\{))*"|-?\d+(?:\.\d+)?|true|false|null)$/.test(text);

/** The docs state an exception to the rule, so the rule may not apply. */
const isException = (condition: string) => /^(?:except|unless)\b/i.test(condition);

const code = (text: string) => `\`${text}\``;
const list = (items: string[]) => (items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** A direct reference gained [0] as its target gained count. Check the target, not arbitrary index edits. */
function followsCountMove(change: AttributeChange, blocks: Map<string, InfraBlock>, hasMove: (address: string) => boolean): boolean {
  const match = /^((?:module|[a-z0-9]+_[a-z0-9_]+)\.[\w-]+)(\.[\w-]+)$/.exec(change.before ?? "");
  if (!match || change.after !== `${match[1]}[0]${match[2]}` || hasMove(match[1])) return false;
  const target = blocks.get(match[1]);
  return !!target && isManaged(target) && target.status === "changed"
    && target.changes.some((c) => c.path === "count" && c.before === null)
    && !target.changes.some((c) => c.path === "for_each");
}

function replaceRisk(block: InfraBlock, skip: (change: AttributeChange) => boolean): Risk | null {
  if (block.kind !== "resource" || !block.type) return null;
  const hits = block.changes
    .filter((c) => !skip(c))
    .map((c) => forceNew(block.type!, c))
    .filter((h): h is ForceNewHit => h !== null);
  if (hits.length === 0) return null;

  // The value itself changed, and the docs give no exception: little room for doubt.
  const sure = hits.filter((h) => isLiteral(h.change.before) && isLiteral(h.change.after) && !isException(h.condition));
  const { list: source } = hits[0];
  const names = [...new Set(hits.map((h) => h.change.path))];
  const exception = hits.find((h) => isException(h.condition));
  let reason = `The ${source.provider} ${source.version} documentation says changing ${list(names.map(code))} forces a new resource`;
  reason += exception ? `, ${exception.condition}.` : ".";
  if (sure.length === 0) {
    if (exception && hits.every((h) => isException(h.condition))) reason += " Check whether that exception applies here.";
    else if (hits.some((h) => h.change.before === null || h.change.after === null)) reason += " Here it is newly set or no longer set: if the resource's value stays the same, nothing is replaced.";
    else reason += " Here the expression changed, which the code alone can't evaluate: if its value stays the same, nothing is replaced.";
  }
  return { kind: "replace", certainty: sure.length > 0 ? "likely" : "possible", reason, attributes: names, docs: { provider: source.provider, version: source.version } };
}

/** `from` and `to` of the head side's `moved` blocks, and what its `removed` blocks cover. */
function refactorings(sides: Map<string, BlockSides>) {
  const moved: { from: string; to: string }[] = [];
  const removed: { from: string; keeps: boolean }[] = [];
  for (const { head } of sides.values()) {
    const from = head?.attributes.get("from");
    if (!head || !from) continue;
    if (head.kind === "moved") moved.push({ from, to: head.attributes.get("to") ?? "" });
    // `lifecycle { destroy = false }` takes the object out of the state and leaves it running.
    if (head.kind === "removed") removed.push({ from, keeps: head.attributes.get("lifecycle.destroy") === "false" });
  }
  /** `address` itself or one of its instances (`address[0]`, `address["key"]`). */
  const covers = (pattern: string, address: string) => pattern === address || pattern.startsWith(`${address}[`);
  return {
    movedFrom: (address: string) => moved.find((m) => m.from === address),
    movesInstance: (address: string) => moved.some((m) => m.from !== address && covers(m.from, address)),
    movedTo: (address: string) => moved.find((m) => covers(m.to, address)),
    keptOnRemoval: (address: string) => removed.some((r) => covers(r.from, address) && r.keeps),
  };
}

/** `azurerm_x.y[0]` and `azurerm_x.y["key"]` are instances of the block `azurerm_x.y`. */
const declaringBlock = (address: string) => address.replace(/\[(?:\d+|"[^"]*")\]$/, "");

const isManaged = (block: InfraBlock) => block.kind === "resource" || block.kind === "module";

/** Fills in `risk` and `notes` on the module's blocks. */
export function assessRisks({ module, sides }: ModuleDiff): InfraModule {
  const { movedFrom, movedTo, movesInstance, keptOnRemoval } = refactorings(sides);
  const byAddress = new Map(module.blocks.map((b) => [b.address, b]));
  const hasMove = (address: string) => !!movedFrom(address) || movesInstance(address) || !!movedTo(address);
  const countMove = (attribute: AttributeChange) => followsCountMove(attribute, byAddress, hasMove);
  const removedResources = module.blocks.filter((b) => b.kind === "resource" && b.status === "removed" && !movedFrom(b.address));

  for (const block of module.blocks) {
    const change = (path: string) => block.changes.find((c) => c.path === path);

    if (isManaged(block) && block.status === "removed") {
      const move = movedFrom(block.address);
      if (move) block.notes.push({ level: "info", text: `A moved block renames it to ${code(move.to)}, which can preserve the object through the address change.` });
      else if (keptOnRemoval(block.address)) block.notes.push({ level: "info", text: "A removed block with destroy = false takes it out of the state and leaves it running." });
      else if (movesInstance(block.address)) block.risk = { kind: "destroy", certainty: "possible", reason: "The block is gone and a moved block covers an individual instance. Other instances may be destroyed." };
      else block.risk = { kind: "destroy", certainty: "likely", reason: "The block is gone, and the changed files show no moved or removed block that preserves it. Terraform may destroy objects still managed at this address." };
    }

    if (block.kind === "resource" && block.status === "added") {
      const move = movedTo(block.address);
      const twin = removedResources.find((r) => r.type === block.type);
      if (move) {
        block.notes.push({ level: "info", text: `A moved block says this is ${code(move.from)} renamed, which can preserve the object through the address change.` });
        // A move may name one instance (`azurerm_x.old[0]`): compare the block that declares it.
        const source = sides.get(declaringBlock(move.from))?.base;
        const destination = sides.get(block.address)?.head;
        if (source && destination && source.type === destination.type) {
          // An instance address already accounts for count and for_each, so they aren't changes to the object.
          const instance = declaringBlock(move.from) !== move.from || declaringBlock(move.to) !== move.to;
          block.changes = attributeChanges(source.attributes, destination.attributes).filter((c) => !instance || (c.path !== "count" && c.path !== "for_each"));
          block.risk = replaceRisk(block, countMove);
        }
      } else if (twin) block.notes.push({ level: "warn", text: `Same type as the removed ${code(twin.address)}. If this is a rename, a moved block keeps the object; without one, Terraform may destroy it and create a new one.` });
    }

    if (isManaged(block) && block.status === "changed") {
      block.risk = replaceRisk(block, countMove);
      const forEach = change("for_each");
      const count = change("count");
      const gained = (c: AttributeChange | undefined) => !!c && c.before === null;
      const lost = (c: AttributeChange | undefined) => !!c && c.after === null;
      if ((gained(forEach) || lost(forEach)) && !movedFrom(block.address)) {
        // Unlike count, Terraform can't guess which key the existing object becomes.
        block.risk ??= {
          kind: "replace",
          certainty: "possible",
          reason: `for_each was ${gained(forEach) ? "added" : "removed"}, so the object's address changes. Without a moved block from the old address to the new one, Terraform may destroy the object and create a new one.`,
          attributes: ["for_each"],
        };
      } else if (gained(count) && !lost(forEach) && !hasMove(block.address)) {
        block.notes.push({ level: "info", text: `count was added. If the count is positive, Terraform normally moves the existing object to ${code(`${block.address}[0]`)}. A zero count may destroy it.` });
      } else if (lost(count) && !movedFrom(block.address)) {
        block.notes.push({ level: "warn", text: "count was removed, so the address loses its index. Check in the plan that Terraform moves the object and doesn't recreate it." });
      }
      const guard = change("lifecycle.prevent_destroy");
      if (guard?.before === "true" && guard.after !== "true") block.notes.push({ level: "warn", text: "prevent_destroy is no longer set, so Terraform may now destroy this resource." });
    }

    if (block.kind === "terraform" && block.status === "changed" && block.changes.some((c) => /^required_providers\..*version$|^required_providers\.[^.]+$/.test(c.path))) {
      block.notes.push({ level: "info", text: "A provider version constraint changed. A new major version can change defaults and what forces a new resource, so read the plan." });
    }
    if (block.kind === "variable" && block.status === "changed" && change("default")) {
      block.notes.push({ level: "info", text: "The default changed. Every environment that doesn't set this variable gets the new value." });
    }
  }

  // One hop only: what a dependent of a dependent does is too far from the code to say.
  const causes = new Map(module.blocks.filter((b) => b.risk?.kind === "destroy" || b.risk?.kind === "replace").map((b) => [b.address, b.risk!]));
  for (const edge of module.edges) {
    const cause = causes.get(edge.from);
    const user = byAddress.get(edge.to);
    // A resource this pull request adds is created after the replacement: it has nothing to lose.
    if (!cause || !user || edge.status === "removed" || !isManaged(user) || user.status === "removed" || user.status === "added" || user.risk) continue;
    const fate = cause.kind === "destroy" ? "destroyed" : "replaced";
    user.risk = {
      kind: "follows",
      certainty: "possible",
      reason: `Uses ${code(edge.from)} through ${list(edge.via.map(code))}, and that resource may be ${fate}. Depending on the provider, this one is then recreated, updated in place, or left pointing at something that is gone.`,
      cause: edge.from,
    };
  }
  return module;
}
