import * as React from "react";
import type { Link } from "../../../../src/core/types";
import type { FlowBox } from "../../../../src/relations/flow";
import { isMember } from "../../../../src/relations/relations";
import { cx } from "../util";

interface Props {
  boxes: FlowBox[];
  links: Link[];
  color: string;
  /** The box id, or the `key` of a link's two boxes, shown as picked. */
  selected: string | null;
  linkKey: (from: string, to: string) => string;
  onSelectBox: (id: string) => void;
  onSelectLink: (from: string, to: string) => void;
}

/**
 * A concern's flow as an outline, for phones, where the map of cards doesn't fit: each function that uses others,
 * then what it uses and from where, one row each. Nothing to lay out, so it never scrolls sideways. A function two
 * others use shows under both. Rows pick the same changes as the map's cards and connectors.
 */
export const FlowOutline: React.FC<Props> = ({ boxes, links, color, selected, linkKey, onSelectBox, onSelectLink }) => {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const users = boxes.filter((b) => links.some((l) => l.to === b.id));
  return (
    <div className="flow-outline" style={{ "--node-color": color } as React.CSSProperties}>
      {users.map((user) => (
        <div key={user.id} className="flow-outline-group">
          <button className={cx("flow-outline-root", selected === user.id && "selected")} aria-pressed={selected === user.id} onClick={() => onSelectBox(user.id)}>
            <strong>{user.title}</strong>
            <span className="flow-outline-file">{user.subtitle}</span>
            <Stats box={user} />
          </button>
          <ul>
            {links
              .filter((l) => l.to === user.id)
              .map((link) => {
                const source = byId.get(link.from)!;
                // The source's own name says nothing next to "from <source>", and the user doesn't use its own.
                const names = link.symbols.filter((s) => s !== source.title && s !== user.title);
                const shown = names.filter((s) => !isMember(s)).concat(names.filter(isMember)).slice(0, 3);
                const key = linkKey(link.from, link.to);
                return (
                  <li key={link.from}>
                    <button className={cx("flow-outline-row", selected === key && "selected")} aria-pressed={selected === key} onClick={() => onSelectLink(link.from, link.to)}>
                      <span className="muted">uses</span>
                      {shown.map((name) => (
                        <code key={name}>{name}</code>
                      ))}
                      {names.length > shown.length && <span className="muted">+{names.length - shown.length}</span>}
                      {shown.length > 0 && <span className="muted">from</span>}
                      <strong>{source.title}</strong>
                      <Stats box={source} />
                    </button>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </div>
  );
};

const Stats: React.FC<{ box: FlowBox }> = ({ box }) =>
  box.adds === undefined || box.dels === undefined ? null : (
    <span className="flow-outline-stats">
      <span className="adds">+{box.adds}</span> <span className="dels">−{box.dels}</span>
    </span>
  );
