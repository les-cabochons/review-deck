import * as React from "react";
import type { Group, Link } from "../../../../src/core/types";
import { isLoose, isMember } from "../../../../src/relations/relations";
import { groupColor } from "../groupColors";
import { plural } from "../util";

interface Props {
  groups: Group[];
  links: Link[];
  onOpenGroup: (id: string) => void;
}

/**
 * How each concern connects to the others, in sentences, in guide order: what it uses from which concern, which
 * concerns use it, which test it, and "reviewable on its own" when nothing does. The map shows the same, drawn;
 * this list is what a screen reader and a phone get.
 */
export const ConcernList: React.FC<Props> = ({ groups, links, onOpenGroup }) => {
  const concerns = groups.filter((g) => g.kind === "semantic");
  const others = groups.filter((g) => g.kind !== "semantic");
  const badge = (id: string) => {
    const g = concerns.find((c) => c.id === id);
    if (!g) return null;
    return (
      <button className="badge concern-ref" style={{ background: groupColor(groups, g) }} title={g.title} aria-label={`concern ${concerns.indexOf(g) + 1}: ${g.title}`} onClick={() => onOpenGroup(g.id)}>
        {concerns.indexOf(g) + 1}
      </button>
    );
  };
  const names = (symbols: string[]): React.ReactNode[] => {
    const shown = symbols.filter((s) => !isMember(s)).slice(0, 3);
    const list = (shown.length ? shown : symbols.slice(0, 2)).map((s) => <code key={s}>{s}</code>);
    return list.flatMap((n, i) => (i === 0 ? [n] : [i === list.length - 1 ? " and " : ", ", n]));
  };

  return (
    <ol className="concern-list">
      {concerns.map((g, i) => {
        const strong = links.filter((l) => !isLoose(l));
        const uses = strong.filter((l) => l.kind === "uses" && l.to === g.id);
        const usedBy = strong.filter((l) => l.kind === "uses" && l.from === g.id);
        const testedIn = strong.filter((l) => l.kind === "tests" && l.from === g.id);
        const tests = strong.filter((l) => l.kind === "tests" && l.to === g.id);
        const loose = links.filter((l) => isLoose(l) && (l.from === g.id || l.to === g.id));
        const alone = uses.length + usedBy.length + testedIn.length + tests.length === 0;
        return (
          <li key={g.id} style={{ borderLeftColor: groupColor(groups, g) }}>
            <button className="concern-list-title link-button" onClick={() => onOpenGroup(g.id)}>
              <span className="badge" style={{ background: groupColor(groups, g) }}>
                {i + 1}
              </span>
              {g.title}
            </button>
            <span className="muted concern-list-count">{plural(g.hunkIds.length, "change")}</span>
            <ul>
              {usedBy.length > 0 && uses.length === 0 && <li>Start here: it uses nothing the other concerns change.</li>}
              {uses.map((l) => (
                <li key={`u${l.from}`}>
                  Uses {names(l.symbols)} from {badge(l.from)}
                </li>
              ))}
              {usedBy.map((l) => (
                <li key={`b${l.to}`}>
                  {badge(l.to)} uses its {names(l.symbols)}
                </li>
              ))}
              {testedIn.map((l) => (
                <li key={`t${l.to}`}>
                  Tested by changes in {badge(l.to)}, through {names(l.symbols)}
                </li>
              ))}
              {tests.map((l) => (
                <li key={`s${l.from}`}>
                  Tests {badge(l.from)}, through {names(l.symbols)}
                </li>
              ))}
              {loose.length > 0 && <LooseLine concernId={g.id} links={loose} badge={badge} />}
              {alone && <li>No link to the other concerns: reviewable on its own.</li>}
            </ul>
          </li>
        );
      })}
      {others.length > 0 && (
        <li className="concern-list-other">
          <span className="concern-list-title">Other changes</span>
          <span className="muted concern-list-count">{plural(others.reduce((n, g) => n + g.hunkIds.length, 0), "change")}, not linked</span>
        </li>
      )}
    </ol>
  );
};

/**
 * A concern's loose matches in one line: links that rest only on member names (`.kind`), which match whatever object
 * they are on. They may be real, so they are listed, but they don't count as links.
 */
const LooseLine: React.FC<{ concernId: string; links: Link[]; badge: (id: string) => React.ReactNode }> = ({ concernId, links, badge }) => {
  const others = [...new Set(links.map((l) => (l.from === concernId ? l.to : l.from)))];
  const members = [...new Set(links.flatMap((l) => l.symbols))].slice(0, 4);
  return (
    <li className="muted">
      Loose match with {others.map((id, i) => <React.Fragment key={id}>{i > 0 && " "}{badge(id)}</React.Fragment>)} through member names only (
      {members.map((m, i) => <React.Fragment key={m}>{i > 0 && ", "}<code>{m}</code></React.Fragment>)}), which match on any object.
    </li>
  );
};
