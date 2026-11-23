import * as React from "react";
import { blockTitle, isInfrastructure, needsLook, pairStatus, riskRank } from "../../../../src/infra/blocks";
import { type ModuleLink, type ModuleMap as Map_, type ModuleNode, moduleMap } from "../../../../src/infra/modules";
import type { InfraBlock, InfraModule } from "../../../../src/infra/types";
import type { MapRow } from "../../../../src/relations/diagram";
import RelationMap from "../relations/RelationMap";
import { NARROW_SCREEN, useMediaQuery } from "../useMediaQuery";
import { cx, plural } from "../util";
import { verdict } from "./verdict";

interface Props {
  modules: InfraModule[];
  /** A changed module was picked: the tab shows its own section. */
  onSelect: (dir: string) => void;
}

/** Room the full map takes before the rest is reached by dragging, and the Overview thumbnail's. */
const HEIGHT = { full: 440, compact: 150 };

/** Rows a module lists before "and N more": the module's section below has them all. */
const MAX_ROWS = 6;
const EDGE_MARK = { added: "+ ", removed: "− ", touched: "~ ", same: "" };

/**
 * The map of the modules a pull request changes (src/infra/modules.ts): a card per folder listing its changes, and
 * arrows for the values that pass between modules, labelled with the outputs. On a phone, the same as an outline:
 * each root, then the modules it calls, indented.
 */
export const ModuleMap: React.FC<Props> = ({ modules, onSelect }) => {
  const map = React.useMemo(() => moduleMap(modules), [modules]);
  const narrow = useMediaQuery(NARROW_SCREEN);
  return (
    <section className="infra-module-map" aria-label="Modules this pull request changes">
      <h3>Modules</h3>
      {narrow ? <ModuleOutline map={map} onSelect={onSelect} /> : <ModuleDrawing map={map} onSelect={onSelect} />}
    </section>
  );
};

/** The Overview card's thumbnail of the map: the modules and their arrows, fitted whole, without their lists. */
export const ModuleThumbnail: React.FC<{ modules: InfraModule[] }> = ({ modules }) => {
  const map = React.useMemo(() => moduleMap(modules), [modules]);
  return <ModuleDrawing map={map} compact />;
};

/** What a changed module lists: its resources, data sources and module calls that changed or are at risk, then its inputs and outputs. */
function listed(module: InfraModule): InfraBlock[] {
  const wiring = (b: InfraBlock) => (b.kind === "variable" || b.kind === "output") && b.status !== "same" && !b.docsOnly;
  return module.blocks.filter((b) => (isInfrastructure(b) && needsLook(b)) || wiring(b)).sort((a, b) => riskRank(a) - riskRank(b) || a.address.localeCompare(b.address));
}

function row(block: InfraBlock): MapRow {
  const { symbol, tone } = verdict(block);
  const text = block.kind === "resource" || block.kind === "data" ? blockTitle(block).title : block.kind === "module" ? "Module" : block.kind;
  return { mark: symbol, text, name: block.name, tone: `tone-${tone}` };
}

/** A module's subtitle: what it is when it isn't changed, its files when it is. */
function subtitle(node: ModuleNode): string {
  if (node.kind === "neighbour") return "no change in this PR";
  if (node.kind === "remote") return "remote module, not read";
  if (node.kind === "unknown") return "declared in a file this PR doesn't change";
  return plural(node.module!.files.length, "changed file");
}

/** The worst tone of a module's changes, for its card's border. Grey for what the PR doesn't change. */
function tone(node: ModuleNode): string {
  const first = node.module ? listed(node.module)[0] : undefined;
  return `tone-${first ? verdict(first).tone : "same"}`;
}

const ModuleDrawing: React.FC<{ map: Map_; onSelect?: (dir: string) => void; compact?: boolean }> = ({ map, onSelect, compact }) => {
  const nodes = React.useMemo(() => new Map(map.nodes.map((n) => [n.id, n])), [map]);
  const links = React.useMemo(() => new Map(map.links.map((l) => [`${l.from}\u0000${l.to}`, l])), [map]);
  const items = React.useMemo(
    () =>
      map.nodes.map((node) => {
        // A thumbnail is too small to read the lists: its cards are their names.
        const blocks = node.module && !compact ? listed(node.module) : [];
        const rows = blocks.slice(0, MAX_ROWS).map(row);
        if (blocks.length > MAX_ROWS) rows.push({ mark: "", text: `and ${blocks.length - MAX_ROWS} more` });
        return {
          id: node.id,
          title: node.label,
          subtitle: subtitle(node),
          tooltip: node.module ? `${node.label}: ${node.module.files.join(", ")}` : `${node.label}: ${subtitle(node)}`,
          rows,
        };
      }),
    [map, compact],
  );
  const relations = React.useMemo(() => map.links.map((l) => ({ from: l.from, to: l.to, symbols: l.names })), [map]);
  return (
    <RelationMap
      items={items}
      links={relations}
      apartCaption="Not linked to the others by a changed file"
      height={compact ? HEIGHT.compact : HEIGHT.full}
      compact={compact}
      label="Map of the modules this pull request changes"
      cardClass={(id) => tone(nodes.get(id)!)}
      selectable={(id) => nodes.get(id)?.kind === "changed"}
      onSelect={onSelect}
      edgeInfo={(from, to) => {
        const status = pairStatus(links.get(`${from}\u0000${to}`)?.status, links.get(`${to}\u0000${from}`)?.status);
        return status && { className: status === "same" ? undefined : status, mark: EDGE_MARK[status] };
      }}
    />
  );
};

/** "Gets + queue_name and account_name from modules/storage": the outputs a module's inputs read, by the module giving them. */
function gets(id: string, map: Map_, labels: ReadonlyMap<string, string>): string | null {
  const incoming = map.links.filter((l) => l.to === id && l.names.length > 0);
  if (incoming.length === 0) return null;
  const names = (l: ModuleLink) => {
    const list = l.names.map((n) => `${EDGE_MARK[l.status]}${n}`);
    return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0];
  };
  return `Gets ${incoming.map((l) => `${names(l)} from ${labels.get(l.from) ?? l.from}`).join("; ")}`;
}

const ModuleOutline: React.FC<{ map: Map_; onSelect: (dir: string) => void }> = ({ map, onSelect }) => {
  const labels = new Map(map.nodes.map((n) => [n.id, n.label]));
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const changed = new Set(map.nodes.filter((n) => n.kind === "changed").map((n) => n.id));
  // Each folder no changed folder calls is a root; the modules it calls go under it, indented.
  const called = new Set(map.calls.filter((c) => changed.has(c.caller)).map((c) => c.callee));
  const shown = new Set<string>();
  /** A module's entry, the first time. Under a later caller (`caller`), a line that points to it. At the top, nothing. */
  const entry = (node: ModuleNode, caller?: string): React.ReactNode => {
    if (shown.has(node.id))
      return caller === undefined ? null : (
        <div key={`${caller}>${node.id}`} className={cx("infra-outline-module", "infra-outline-ref", tone(node))}>
          <code>{node.label}</code> <span className="muted">listed above</span>
        </div>
      );
    shown.add(node.id);
    const callees = [...new Set(map.calls.filter((c) => c.caller === node.id).map((c) => c.callee))]
      .map((id) => byId.get(id)!)
      // What the PR changes first; the grey neighbours after.
      .sort((a, b) => Number(a.kind !== "changed") - Number(b.kind !== "changed"));
    const blocks = node.module ? listed(node.module) : [];
    const line = gets(node.id, map, labels);
    return (
      <React.Fragment key={node.id}>
        <div className={cx("infra-outline-module", tone(node))}>
          <div className="infra-outline-head">
            {node.kind === "changed" ? (
              <button className="link-button" onClick={() => onSelect(node.id)}>
                {node.label}
              </button>
            ) : (
              <code>{node.label}</code>
            )}
            <span className="muted">{node.kind === "changed" && callees.length > 0 ? `${subtitle(node)} · calls ${plural(callees.length, "module")}` : subtitle(node)}</span>
          </div>
          {blocks.length > 0 && (
            <ul>
              {blocks.map((block) => {
                const r = row(block);
                return (
                  <li key={block.address}>
                    <span className={cx("infra-outline-mark", r.tone)}>{r.mark}</span>
                    {r.text} <code>{r.name}</code>
                  </li>
                );
              })}
            </ul>
          )}
          {line && <p className="infra-outline-gets">{line}</p>}
        </div>
        {callees.length > 0 && <div className="infra-outline-callees">{callees.map((callee) => entry(callee, node.id))}</div>}
      </React.Fragment>
    );
  };
  return (
    <div className="infra-outline">
      {map.nodes.filter((n) => n.kind === "changed" && !called.has(n.id)).map((n) => entry(n))}
      {/* A cycle of calls has no root: what is left still shows. */}
      {map.nodes.filter((n) => n.kind === "changed").map((n) => entry(n))}
    </div>
  );
};
