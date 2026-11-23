import * as React from "react";
import { isLoose } from "../../../../src/relations/relations";
import type { PrOverview } from "../../data/model";
import { buildChangelog } from "../../data/releases";
import type { ReviewModel } from "../../review/engine";
import { groupColor } from "../groupColors";
import { NARROW_SCREEN, useMediaQuery } from "../useMediaQuery";
import { plural } from "../util";
import { ConcernList } from "./ConcernList";
import { useDiagramsShown } from "./diagramsShown";
import { DiagramControls, HowToRead } from "./HowToRead";

const RelationMap = React.lazy(() => import("./RelationMap"));

interface Props {
  data: PrOverview;
  review: ReviewModel | null;
  onOpenGroup: (id: string) => void;
}

/**
 * The pull request described from what Review Deck reads, not from what its author wrote: why, from the commit
 * messages; what changed, from the guide's concerns; and how they connect, from the names they share. What it can't
 * know (how the change was tested, what could break) is in docs/generated-description.md, not on the page.
 */
const GeneratedDescription: React.FC<Props> = ({ data, review, onOpenGroup }) => {
  return (
    <div className="generated-description">
      <section>
        <h4>Why</h4>
        <Why data={data} />
      </section>
      <section>
        <WhatChanged review={review} onOpenGroup={onOpenGroup} />
      </section>
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
  const [shown, setShown] = useDiagramsShown();
  const [reading, setReading] = React.useState(false);
  const narrow = useMediaQuery(NARROW_SCREEN);
  if (!review?.analyzed) return <p className="muted">Building the guide…</p>;
  const { groups, relations } = review.result;
  const concerns = groups.filter((g) => g.kind === "semantic");
  if (concerns.length === 0) return <p className="muted">No concern to describe: every change is mechanical or stands alone.</p>;
  const links = relations?.links ?? [];
  const drawn = new Set(links.filter((l) => !isLoose(l)).flatMap((l) => [l.from, l.to]));
  const items = concerns.map((g) => {
    const lines = g.hunkIds.flatMap((id) => review.result.hunks.get(id)?.hunk.lines ?? []);
    return {
      id: g.id,
      title: g.title,
      subtitle: plural(g.hunkIds.length, "change"),
      adds: lines.filter((l) => l.kind === "add").length,
      dels: lines.filter((l) => l.kind === "del").length,
    };
  });
  // On a phone the map doesn't fit, and the list below says the same.
  const mapShown = !!relations && concerns.length > 1 && shown && !narrow;
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
      {mapShown && (
        <div className="generated-map-head">
          <DiagramControls reading={reading} onReading={setReading} onHide={() => setShown(false)} />
        </div>
      )}
      {mapShown && reading && <HowToRead kind="concerns" />}
      {mapShown && (
        <React.Suspense fallback={<div className="relation-map loading">Drawing the map…</div>}>
          <RelationMap
            items={items}
            links={links}
            color={(id) => colors.get(id) ?? "#8a8886"}
            badge={(id) => index.get(id) ?? null}
            apartCaption="On their own"
            onSelect={onOpenGroup}
            height={420}
            label={`Map of the ${concerns.length} concerns and the names that link them`}
          />
        </React.Suspense>
      )}
      <h4>How they connect</h4>
      <ConcernList groups={groups} links={relations ? links : null} onOpenGroup={onOpenGroup} />
    </>
  );
};
