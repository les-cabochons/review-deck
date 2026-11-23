import { Icon } from "azure-devops-ui/Icon";
import * as React from "react";
import { isLineAnchor, type PrOverview, type Thread } from "../data/model";
import type { ReviewModel } from "../review/engine";
import { groupColor } from "./groupColors";
import { GuideSummaryCard } from "./GuideSummary";
import type { InfraState } from "./infra/useInfra";
import { HostLinks } from "./App";
import { ThreadCard } from "./ThreadCard";
import { CommentComposer } from "./CommentComposer";
import { Reviewers, Tags } from "./MetadataEditors";
import { OthersOnPr } from "./presence/Presence";
import { useReviewActions } from "./ReviewActions";
import { Avatar, CommitLink, cx, isOpen, Markdown, plural, Time, voteInfo } from "./util";

/** The description from what Review Deck reads, behind the description card's toggle. */
const GeneratedDescription = React.lazy(() => import("./relations/GeneratedDescription"));
const InfraCard = React.lazy(() => import("./infra/InfraCard").then(({ InfraCard }) => ({ default: InfraCard })));

interface Props {
  data: PrOverview;
  review: ReviewModel | null;
  /** The comparison's Terraform changes, summarized under the description. */
  infra: InfraState;
  onOpenInfra: () => void;
  /** The analysis is running; until then the files load, and a saved guided view needs nothing more. */
  building: boolean;
  onOpenGroup: (groupId: string) => void;
  /** Shows a code comment where it sits on the Files tab. */
  onOpenThread: (thread: Thread) => void;
  /** Shows what one update pushed on the Files tab. */
  onOpenUpdate: (iterationId: number) => void;
  /** Shown first in the sidebar (the stack panel). */
  sidebarTop?: React.ReactNode;
}

export const OverviewTab: React.FC<Props> = ({ data, review, infra, onOpenInfra, building, onOpenGroup, onOpenThread, onOpenUpdate, sidebarTop }) => {
  const { actions } = useReviewActions();
  return (
    <div className="overview">
      <div className="overview-main">
        {review?.analyzed && <GuideSummaryCard review={review} onOpenGroup={onOpenGroup} />}
        <DescriptionCard data={data} review={review} onOpenGroup={onOpenGroup} />
        {infra.present && (
          <React.Suspense fallback={null}>
            <InfraCard infra={infra} onOpen={onOpenInfra} />
          </React.Suspense>
        )}
        <Timeline data={data} onOpenThread={onOpenThread} onOpenUpdate={onOpenUpdate} />
        <CommentComposer label="Add a comment" onSave={(content) => actions.createThread({ content })} />
      </div>
      <aside className="overview-side">
        {sidebarTop}
        <SemanticSummary review={review} building={building} onOpenGroup={onOpenGroup} />
        <Reviewers data={data} />
        <OthersOnPr reviewers={data.pr.reviewers} />
        <Checks data={data} />
        <Tags data={data} />
        <WorkItems data={data} />
      </aside>
    </div>
  );
};

/**
 * The author's description, or, behind the toggle, one generated from what Review Deck reads (GeneratedDescription).
 * It always opens on the author's: the generated one doesn't know how the change was tested or what could break.
 */
const DescriptionCard: React.FC<{ data: PrOverview; review: ReviewModel | null; onOpenGroup: (groupId: string) => void }> = ({ data, review, onOpenGroup }) => {
  const { pr } = data;
  const { actions, disabled } = useReviewActions();
  const [editing, setEditing] = React.useState(false);
  const [generated, setGenerated] = React.useState(false);
  return (
    <div className="timeline-card description">
      <div className="card-head">
        <Avatar who={pr.createdBy} size={32} />
        <div>
          <strong>{pr.createdBy.displayName}</strong> opened this pull request <Time date={pr.creationDate} />
        </div>
        <div className="description-source" role="group" aria-label="Description">
          <button aria-pressed={!generated} onClick={() => setGenerated(false)}>
            Written by {pr.createdBy.displayName}
          </button>
          <button aria-pressed={generated} onClick={() => setGenerated(true)}>
            Generated
          </button>
        </div>
        {!generated && (
          <button className="link-button description-edit" disabled={disabled} onClick={() => setEditing(!editing)}>
            {editing ? "Cancel" : "Edit description"}
          </button>
        )}
      </div>
      {generated ? (
        <React.Suspense fallback={<div className="card-body muted">Loading…</div>}>
          <GeneratedDescription data={data} review={review} onOpenGroup={onOpenGroup} onShowWritten={() => setGenerated(false)} />
        </React.Suspense>
      ) : editing ? (
        <CommentComposer
          label="Pull request description"
          submitText="Save description"
          initial={pr.description}
          allowEmpty
          onSave={actions.setDescription}
          onCancel={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : (
        <Markdown text={pr.description} className="card-body" />
      )}
    </div>
  );
};

type TimelineItem = { date: Date; key: string; node: React.ReactNode };

const Timeline: React.FC<{
  data: PrOverview;
  onOpenThread: (thread: Thread) => void;
  onOpenUpdate: (iterationId: number) => void;
}> = ({ data, onOpenThread, onOpenUpdate }) => {
  const links = React.useContext(HostLinks);
  const commitById = new Map(data.commits.map((c) => [c.id, c]));
  const items: TimelineItem[] = [];

  for (const it of data.iterations) {
    const commits = it.commitIds.map((id) => commitById.get(id)).filter(Boolean);
    // The commits' messages come with the rest of the page (PrOverview.partial); the update knows how many it pushed.
    const count = data.partial ? it.commitIds.length : commits.length;
    items.push({
      date: it.createdDate,
      key: `it${it.id}`,
      node: (
        <Event
          icon="BranchPullRequest"
          who={it.author}
          date={it.createdDate}
          details={
            commits.length > 0 && (
              <ul className="event-commits">
                {commits.map((c) => (
                  <li key={c!.id}>
                    <CommitLink url={links.commitUrl(c!.id)}>
                      <code>{c!.id.slice(0, 7)}</code> {c!.message.split("\n")[0]}
                    </CommitLink>
                  </li>
                ))}
              </ul>
            )
          }
        >
          {it.id === 1 ? "created " : "pushed "}
          <button className="link-button" onClick={() => onOpenUpdate(it.id)} title={`Show the changes of update ${it.id} on the Files tab`}>
            update {it.id}
          </button>{" "}
          with {plural(Math.max(count, 1), "commit")}
        </Event>
      ),
    });
  }

  for (const t of data.threads) {
    const author = t.comments[0]?.author;
    if (!author) continue;
    if (t.kind === "vote") {
      const v = voteInfo(t.vote ?? 0);
      items.push({
        date: t.published,
        key: `t${t.id}`,
        node: (
          <Event icon={v.icon || "Accept"} tone={v.tone} who={author} date={t.published}>
            {v.label.toLowerCase() === "approved" ? "approved these changes" : `voted “${v.label}”`}
          </Event>
        ),
      });
    } else if (t.kind === "system") {
      items.push({
        date: t.published,
        key: `t${t.id}`,
        node: (
          <Event icon="Info" who={author} date={t.published}>
            {t.comments[0]?.content}
          </Event>
        ),
      });
    } else {
      items.push({
        date: t.published,
        key: `t${t.id}`,
        node: (
          <div className="timeline-thread">
            <ThreadCard
              thread={t}
              fileLabel={
                t.file ? (
                  <button className="link-button" onClick={() => onOpenThread(t)}>
                    <Icon iconName="FileCode" /> {t.file.path}{isLineAnchor(t.file) && `:${t.file.line}`}
                  </button>
                ) : undefined
              }
            />
          </div>
        ),
      });
    }
  }

  items.sort((a, b) => a.date.getTime() - b.date.getTime());
  return (
    <ol className="timeline">
      {items.map((i) => (
        <li key={i.key}>{i.node}</li>
      ))}
      {data.partial && (
        <li className="muted" aria-busy="true">
          Loading comments and votes…
        </li>
      )}
    </ol>
  );
};

const Event: React.FC<{
  icon: string;
  tone?: string;
  who: { displayName: string; imageUrl?: string; id: string; uniqueName: string };
  date: Date;
  details?: React.ReactNode;
}> = ({ icon, tone, who, date, details, children }) => (
  <div className="event">
    <span className={cx("event-icon", tone && `tone-${tone}`)}>
      <Icon iconName={icon} />
    </span>
    <div className="event-text">
      <Avatar who={who} size={20} /> <strong>{who.displayName}</strong> {children}{" "}
      <span className="muted">
        · <Time date={date} />
      </span>
      {details}
    </div>
  </div>
);

// ---------- sidebar ----------

const Side: React.FC<{ title: string; action?: string }> = ({ title, action, children }) => (
  <section className="side-section">
    <h3>
      {title}
      {action && (
        <button className="link-button" disabled title="Editing arrives in milestone 2">
          {action}
        </button>
      )}
    </h3>
    {children}
  </section>
);

const SemanticSummary: React.FC<{ review: ReviewModel | null; building: boolean; onOpenGroup: (id: string) => void }> = ({ review, building, onOpenGroup }) => (
  <Side title="Guided review">
    {!review?.analyzed ? (
      <p className="muted">{building ? "Building guided view…" : "Loading guided view…"}</p>
    ) : (
      <>
        {review.published && <p className="guide-source">Published from Ajour</p>}
        <ul className="summary-groups">
          {review.result.groups.map((g, i) => (
            <li key={g.id}>
              <button className="summary-group" onClick={() => onOpenGroup(g.id)}>
                <span className="badge" style={{ background: groupColor(review.result.groups, g) }}>
                  {i + 1}
                </span>
                <span className={cx("text", g.kind !== "semantic" && "muted")}>{g.title}</span>
                <span className="count">{g.hunkIds.length}</span>
              </button>
            </li>
          ))}
        </ul>
      </>
    )}
  </Side>
);

const POLICY_ICON: Record<string, { icon: string; tone: string; label: string }> = {
  approved: { icon: "CompletedSolid", tone: "success", label: "Succeeded" },
  rejected: { icon: "StatusErrorFull", tone: "error", label: "Failed" },
  running: { icon: "ProgressLoopOuter", tone: "info", label: "Running" },
  queued: { icon: "Clock", tone: "neutral", label: "Queued" },
  notApplicable: { icon: "CircleRing", tone: "neutral", label: "Not applicable" },
  broken: { icon: "Warning", tone: "warning", label: "Broken" },
};

const Checks: React.FC<{ data: PrOverview }> = ({ data }) => {
  if (data.partial)
    return (
      <Side title="Checks">
        <p className="muted">Loading checks…</p>
      </Side>
    );
  const required = data.policies.filter((p) => p.blocking);
  const optional = data.policies.filter((p) => !p.blocking);
  const openThreads = data.threads.filter((t) => t.kind === "comment" && isOpen(t.status)).length;
  const row = (p: PrOverview["policies"][number]) => {
    const s = POLICY_ICON[p.state];
    return (
      <li key={p.id} title={s.label}>
        <span className={`tone-${s.tone}`}>
          <Icon iconName={s.icon} />
        </span>
        <span className="name">
          {p.name}
          {p.detail && <span className="muted"> · {p.detail}</span>}
        </span>
      </li>
    );
  };
  return (
    <Side title="Checks">
      {data.policies.length === 0 && <p className="muted">No policies</p>}
      {required.length > 0 && (
        <>
          <h4>Required</h4>
          <ul className="checks">{required.map(row)}</ul>
        </>
      )}
      {optional.length > 0 && (
        <>
          <h4>Optional</h4>
          <ul className="checks">{optional.map(row)}</ul>
        </>
      )}
      <p className="muted">{plural(openThreads, "active comment thread")}</p>
    </Side>
  );
};

const WorkItems: React.FC<{ data: PrOverview }> = ({ data }) => (
  <Side title="Work items" action="Link">
    {data.partial ? (
      <p className="muted">Loading work items…</p>
    ) : data.workItems.length === 0 ? (
      <p className="muted">No work items linked</p>
    ) : (
      <ul className="work-items">
        {data.workItems.map((w) => (
          <li key={w.id}>
            <Icon iconName="WorkItem" /> <a href={w.url}>#{w.id}</a> {w.title}
          </li>
        ))}
      </ul>
    )}
  </Side>
);

export function openThreadCount(threads: Thread[]): number {
  return threads.filter((t) => t.kind === "comment" && isOpen(t.status)).length;
}
