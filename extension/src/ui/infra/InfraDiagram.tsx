import * as React from "react";
import { blockTitle, needsLook } from "../../../../src/infra/blocks";
import { diagramContent, edgeName } from "../../../../src/infra/diagram";
import type { InfraModule } from "../../../../src/infra/types";
import RelationMap from "../relations/RelationMap";
import { verdict } from "./verdict";

interface Props {
  module: InfraModule;
  /** A thumbnail: fitted whole, without labels, and not interactive. */
  compact?: boolean;
  /** A changed card was clicked, or activated with Enter or Space. */
  onSelect?: (address: string) => void;
}

/** Room the full diagram takes before the rest is reached by dragging, and the thumbnail's. */
const HEIGHT = { full: 440, compact: 150 };
const EDGE_MARK = { added: "+ ", removed: "− ", touched: "~ ", same: "" };

/**
 * The diagram of a module's changes: each changed resource with what the change involves around it
 * (src/infra/diagram.ts picks them), in the columns and connectors of the relations map, on a canvas the reader drags.
 * Colour is never the only cue: every state has its own symbol and border.
 */
const InfraDiagram: React.FC<Props> = ({ module, compact, onSelect }) => {
  const content = React.useMemo(() => diagramContent(module), [module]);
  const blocks = React.useMemo(() => new Map(content.blocks.map((b) => [b.address, b])), [content]);
  const edges = React.useMemo(() => new Map(content.edges.map((e) => [`${e.from}\u0000${e.to}`, e])), [content]);
  const items = React.useMemo(
    () =>
      content.blocks.map((block) => {
        const { title, subtitle } = blockTitle(block);
        const { symbol, label } = verdict(block);
        return {
          id: block.address,
          title: `${symbol ? `${symbol} ` : ""}${title}`,
          subtitle,
          tooltip: `${block.address}: ${label}${block.file ? "" : " (declared in a file this pull request doesn't change)"}`,
        };
      }),
    [content],
  );
  const links = React.useMemo(() => content.edges.map((e) => ({ from: e.from, to: e.to, symbols: e.via.map(edgeName) })), [content]);
  if (content.blocks.length === 0) return <p className="muted infra-diagram-empty">Nothing to draw: no resource, data source or module changed.</p>;
  return (
    <RelationMap
      items={items}
      links={links}
      apartCaption="Not linked to the others"
      height={compact ? HEIGHT.compact : HEIGHT.full}
      compact={compact}
      label={`Diagram of the Terraform changes in ${module.dir || "the repository root"}`}
      cardClass={(address) => {
        const block = blocks.get(address)!;
        const wiring = block.kind === "variable" || block.kind === "local" || block.kind === "output";
        return `tone-${verdict(block).tone}${wiring ? " wiring" : ""}`;
      }}
      selectable={(address) => needsLook(blocks.get(address)!)}
      onSelect={onSelect}
      edgeInfo={(from, to) => {
        // The layout merges both ways of a pair; an Infra edge points one way.
        const edge = edges.get(`${from}\u0000${to}`) ?? edges.get(`${to}\u0000${from}`);
        // An unchanged reference is drawn, without its names: they say nothing about the change.
        return edge && { className: edge.status === "same" ? undefined : edge.status, mark: EDGE_MARK[edge.status], quiet: edge.status === "same" };
      }}
    />
  );
};
export default InfraDiagram;
