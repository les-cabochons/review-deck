import * as React from "react";
import type { Group } from "../../../src/core/types";
import type { ReviewModel } from "../review/engine";
import { CHANGE_KINDS, type ChangeKind, type GuideSummary, type SummaryItem } from "../review/saved";
import { groupColor } from "./groupColors";

const KIND_LABEL: Record<ChangeKind, string> = {
  breaking: "Breaking",
  feature: "Feature",
  fix: "Fix",
  refactor: "Refactor",
  performance: "Performance",
  tests: "Tests",
  docs: "Docs",
  dependencies: "Dependencies",
  build: "Build",
};

const LISTS: [keyof Pick<GuideSummary, "breaking" | "risks" | "tests" | "leftovers">, string][] = [
  ["breaking", "Breaking changes"],
  ["risks", "Risky areas"],
  ["tests", "Test coverage"],
  ["leftovers", "Leftovers"],
];

/**
 * The summary a published guide carries, above the guide: what the PR fixes, its kinds of change, then breaking
 * changes, risky areas, test coverage and leftovers, each line linking to the concerns its hunks are in.
 */
export const GuideSummaryCard: React.FC<{ review: ReviewModel; onOpenGroup: (groupId: string) => void }> = ({ review, onOpenGroup }) => {
  const { summary } = review;
  const groups = review.result.groups;
  const groupOf = React.useMemo(() => new Map(groups.flatMap((g) => g.hunkIds.map((id) => [id, g] as const))), [groups]);
  if (!summary) return null;
  const { problem } = summary;
  const kinds = CHANGE_KINDS.filter((k) => summary.kinds.includes(k));
  return (
    <section className="guide-summary" aria-label="Summary">
      <header className="guide-summary-head">
        <h3>Summary</h3>
        {review.published && <span className="muted">Published from Ajour</span>}
      </header>
      <p className="guide-summary-problem">
        {problem.text}{" "}
        <span className="muted">
          {problem.ticket ? (
            <>
              From{" "}
              <a href={problem.ticket.url} target="_blank" rel="noopener noreferrer">
                {problem.ticket.id} {problem.ticket.title}
              </a>
            </>
          ) : problem.source === "ticket" ? (
            "From the linked ticket"
          ) : (
            "Inferred from the commits and code"
          )}
        </span>
      </p>
      {kinds.length > 0 && (
        <div className="guide-summary-kinds" aria-label="Kinds of change">
          {kinds.map((k) => (
            <span key={k} className={`tag kind-${k}`}>
              {KIND_LABEL[k]}
            </span>
          ))}
        </div>
      )}
      {LISTS.map(
        ([field, title]) =>
          summary[field].length > 0 && (
            <div key={field} className={`guide-summary-list list-${field}`}>
              <h4>{title}</h4>
              <ul>
                {summary[field].map((item, i) => (
                  <li key={i}>
                    <span className="text">{item.text}</span>
                    <ConcernLinks item={item} groups={groups} groupOf={groupOf} onOpenGroup={onOpenGroup} />
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}
    </section>
  );
};

/** The concerns holding a line's hunks, as the numbered badges the guide shows. */
const ConcernLinks: React.FC<{ item: SummaryItem; groups: Group[]; groupOf: Map<string, Group>; onOpenGroup: (groupId: string) => void }> = ({
  item,
  groups,
  groupOf,
  onOpenGroup,
}) => {
  const linked = new Set(item.hunkIds.map((id) => groupOf.get(id)).filter((g): g is Group => !!g));
  if (linked.size === 0) return null;
  return (
    <span className="guide-summary-concerns">
      {groups.map((g, i) =>
        linked.has(g) ? (
          <button
            key={g.id}
            className="badge"
            style={{ background: groupColor(groups, g) }}
            title={`Go to concern ${i + 1}: ${g.title}`}
            aria-label={`Go to concern ${i + 1}: ${g.title}`}
            onClick={() => onOpenGroup(g.id)}
          >
            {i + 1}
          </button>
        ) : null,
      )}
    </span>
  );
};
