import * as React from "react";
import { isLoose } from "../../../../src/relations/relations";
import type { PrOverview } from "../../data/model";
import { buildChangelog } from "../../data/releases";
import type { ReviewModel } from "../../review/engine";
import { groupColor } from "../groupColors";
import { plural } from "../util";
import { ConcernList } from "./ConcernList";

const RelationMap = React.lazy(() => import("./RelationMap"));

interface Props {
  data: PrOverview;
  review: ReviewModel | null;
  onOpenGroup: (id: string) => void;
  /** Back to the author's description, which has what this view can't know. */
  onShowWritten: () => void;
}

/**
 * The pull request described from what Review Deck reads, not from what its author wrote: why, from the commit
 * messages; what changed, from the guide's concerns; and how they connect, from the names they share. Each part
 * says where it comes from, and the view says what it can't know.
 */
const GeneratedDescription: React.FC<Props> = ({ data, review, onOpenGroup, onShowWritten }) => {
  const author = data.pr.createdBy.displayName;
  return (
    <div className="generated-description">
      <section>
        <h4>Why</h4>
        <Why data={data} />
      </section>
      <section>
        <WhatChanged review={review} onOpenGroup={onOpenGroup} />
      </section>
      <p className="generated-missing">
        Not in the code, so not here: how it was tested, and what could break.{" "}
        <button className="link-button" onClick={onShowWritten}>
          Written by {author}
        </button>{" "}
        may have them.
      </p>
    </div>
  );
};
export default GeneratedDescription;

/** The commits as a changelog: their subjects, grouped by conventional-commit type, like the Changelog hub. */
const Why: React.FC<{ data: PrOverview }> = ({ data }) => {
  if (data.partial) return <p className="muted">Loading the commits…</p>;
  // A merge from the target branch says nothing about this change. The REST API gives no parent count here, so it
  // goes by Git's own subject.
  const commits = data.commits
    .filter((c) => !/^Merge (branch|remote-tracking branch|pull request) /.test(c.message))
    .map((c) => ({ id: c.id, message: c.message, author: c.authorName, date: c.date }));
  const sections = buildChangelog(commits);
  if (sections.length === 0) return <p className="muted">No commit messages to read.</p>;
  return (
    <>
      {sections.map((s) => (
        <div key={s.key} className="generated-changelog">
          {sections.length > 1 && <h5>{s.title}</h5>}
          <ul>
            {s.entries.map((e) => (
              <li key={e.sha}>
                {e.scope && <span className="muted">{e.scope}: </span>}
                {e.subject}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
};

const WhatChanged: React.FC<{ review: ReviewModel | null; onOpenGroup: (id: string) => void }> = ({ review, onOpenGroup }) => {
  if (!review?.analyzed) return <p className="muted">Building the guide…</p>;
  const { groups, relations } = review.result;
  const concerns = groups.filter((g) => g.kind === "semantic");
  if (concerns.length === 0) return <p className="muted">No concern to describe: every change is mechanical or stands alone.</p>;
  const links = relations?.links ?? [];
  const drawn = new Set(links.filter((l) => !isLoose(l)).flatMap((l) => [l.from, l.to]));
  const items = concerns.map((g) => ({ id: g.id, title: g.title, subtitle: plural(g.hunkIds.length, "change") }));
  const index = new Map(concerns.map((g, i) => [g.id, String(i + 1)]));
  const colors = new Map(concerns.map((g) => [g.id, groupColor(groups, g)]));
  return (
    <>
      <h4>
        What changed · {plural(concerns.length, "concern")}
        {relations && concerns.length > 1 && `, ${drawn.size} linked`}
      </h4>
      {!relations && (
        <p className="generated-note">This guide was saved before Review Deck recorded links. Choose Regroup in Files to see them.</p>
      )}
      {relations && concerns.length > 1 && (
        <React.Suspense fallback={<div className="relation-map loading">Drawing the map…</div>}>
          <RelationMap
            items={items}
            links={links}
            color={(id) => colors.get(id) ?? "#8a8886"}
            badge={(id) => index.get(id) ?? null}
            apartCaption="On their own"
            onSelect={onOpenGroup}
            height={300}
            label={`Map of the ${concerns.length} concerns and the names that link them`}
          />
        </React.Suspense>
      )}
      <h4>How they connect</h4>
      <ConcernList groups={groups} links={relations ? links : null} onOpenGroup={onOpenGroup} />
      {relations && <p className="generated-source muted">Links come from names shared between changed lines. Two different things with the same name look linked, so each link shows its names.</p>}
    </>
  );
};
