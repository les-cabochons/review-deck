import { Button } from "azure-devops-ui/Button";
import { Icon } from "azure-devops-ui/Icon";
import * as React from "react";
import type { AppHost } from "../../app/host";
import {
  inboxSections,
  matchesQuery,
  type MyGroup,
  type PrListSource,
  type PrSummary,
  requestedVia,
  SECTION_META,
  type SectionId,
} from "../../data/list";
import { DropdownButton } from "../controls";
import { AiTitlesSetting } from "./AiTitlesSetting";
import { readPreference, writePreference } from "../preferences";
import { ago, Avatar, cx, plural, voteInfo } from "../util";

type Filter = "inbox" | SectionId;

/** The PR hub: a Graphite-style inbox of pull requests that involve you, in an Azure DevOps skin. */
export const HubPage: React.FC<{ host: AppHost }> = ({ host }) => {
  const [source, setSource] = React.useState<PrListSource | null>(null);
  const [prs, setPrs] = React.useState<PrSummary[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [repo, setRepo] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<Filter>(() => readPreference<Filter>("hub.filter", "inbox"));
  const [collapsed, setCollapsed] = React.useState<Set<SectionId>>(() => new Set(JSON.parse(readPreference("hub.collapsed", '["other"]')) as SectionId[]));
  const [details, setDetails] = React.useState<Map<number, Partial<PrSummary>>>(new Map());
  const [selected, setSelected] = React.useState(0);
  const search = React.useRef<HTMLInputElement>(null);

  const [groups, setGroups] = React.useState<MyGroup[]>([]);
  const [groupError, setGroupError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setError(null);
    host
      .listSource()
      .then(async (s) => {
        setSource(s);
        // Teams only widen "Needs your review"; the list still works without them.
        const [list] = await Promise.all([
          s.list(),
          s.myGroups().then(
            (g) => {
              setGroups(g);
              setGroupError(null);
            },
            (e: Error) => setGroupError(e.message),
          ),
        ]);
        setPrs(list);
      })
      .catch((e: Error) => setError(e.message));
  }, [host]);
  React.useEffect(() => {
    load();
  }, [load]);
  React.useEffect(() => {
    host.setTitle("Pull requests");
  }, [host]);

  const me = host.currentUser;
  const repos = React.useMemo(() => [...new Map((prs ?? []).map((p) => [p.repository.id, p.repository.name])).entries()], [prs]);
  const visible = (prs ?? []).filter((p) => (!repo || p.repository.id === repo) && matchesQuery(p, query));
  const groupIds = React.useMemo(() => new Set(groups.map((g) => g.id)), [groups]);
  const sections = inboxSections(visible, me, groupIds);
  const shown = sections.filter((s) => filter === "inbox" || s.id === filter);
  const rows = shown.flatMap((s) => (collapsed.has(s.id) && filter === "inbox" ? [] : s.prs));

  // Lazily enrich visible rows (checks, comment counts) where the host needs extra calls per PR.
  React.useEffect(() => {
    if (!source?.details) return;
    let cancelled = false;
    const todo = rows.filter((p) => !details.has(p.id)).slice(0, 24);
    if (todo.length === 0) return;
    const queue = [...todo];
    const worker = async () => {
      for (let pr = queue.shift(); pr && !cancelled; pr = queue.shift()) {
        const extra = await source.details!(pr).catch(() => ({}));
        if (!cancelled) setDetails((m) => new Map(m).set(pr!.id, extra));
      }
    };
    void Promise.all([worker(), worker(), worker(), worker()]);
    return () => {
      cancelled = true;
    };
  }, [source, rows.map((r) => r.id).join(",")]);

  const open = (pr: PrSummary) => pr.openable && host.navigate({ view: "pr", repo: pr.repository.id, pr: pr.id });

  // Keyboard: "/" search, j/k or arrows to move, Enter or o to open.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        search.current?.focus();
      } else if (e.key === "Escape" && typing) {
        search.current?.blur();
      } else if (!typing && (e.key === "j" || e.key === "ArrowDown")) {
        e.preventDefault();
        setSelected((i) => Math.min(rows.length - 1, i + 1));
      } else if (!typing && (e.key === "k" || e.key === "ArrowUp")) {
        e.preventDefault();
        setSelected((i) => Math.max(0, i - 1));
      } else if (!typing && (e.key === "Enter" || e.key === "o") && rows[selected]) {
        e.preventDefault();
        open(rows[selected]);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  React.useEffect(() => {
    setSelected(0);
  }, [filter, query, repo]);
  React.useEffect(() => {
    document.querySelector(".pr-row.selected")?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const choose = (f: Filter) => {
    setFilter(f);
    writePreference("hub.filter", f);
  };
  const toggle = (id: SectionId) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    writePreference("hub.collapsed", JSON.stringify([...next]));
  };

  let rowIndex = 0;
  return (
    <div className="hub">
      <aside className="hub-sidebar">
        <div className="hub-sidebar-title">Pull requests</div>
        <nav aria-label="Inbox sections">
          <SidebarItem icon="Inbox" text="Inbox" count={sections.reduce((n, s) => n + (s.id === "other" ? 0 : s.prs.length), 0)} active={filter === "inbox"} onClick={() => choose("inbox")} />
          <div className="hub-sidebar-sep" />
          {sections.map((s) => (
            <SidebarItem
              key={s.id}
              icon={SECTION_META[s.id].icon}
              text={s.title}
              count={s.prs.length}
              active={filter === s.id}
              attention={s.id === "needs-review" || s.id === "returned"}
              onClick={() => choose(s.id)}
            />
          ))}
        </nav>
        {groups.length > 0 && (
          <p className="hub-sidebar-note muted" title={groups.map((g) => g.name).join(", ")}>
            Includes reviews requested from your {groups.length === 1 ? `team ${groups[0].name}` : `${groups.length} teams`}.
          </p>
        )}
        {groupError && (
          <p className="hub-sidebar-note tone-warning" role="status">
            Couldn't load your teams, so only reviews assigned to you directly are counted. {groupError}
          </p>
        )}
        {host.kind === "local" && <p className="hub-sidebar-note muted">Local preview as {me.displayName}. Some reviewer votes and teams are synthetic.</p>}
        <AiTitlesSetting host={host} />
      </aside>

      <main className="hub-main">
        <div className="hub-toolbar">
          <div className="search-box">
            <Icon iconName="Search" />
            <input
              ref={search}
              type="search"
              placeholder="Search by title, number, author, branch or tag"
              aria-label="Search pull requests"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {!query && <kbd>/</kbd>}
          </div>
          <DropdownButton
            text={repo ? (repos.find(([id]) => id === repo)?.[1] ?? "Repository") : "All repositories"}
            icon="Repo"
            options={[
              { id: "all", text: "All repositories", checked: !repo, onSelect: () => setRepo(null) },
              ...repos.map(([id, name]) => ({ id, text: name, checked: repo === id, onSelect: () => setRepo(id) })),
            ]}
          />
          <Button iconProps={{ iconName: "Refresh" }} subtle ariaLabel="Refresh" onClick={load} />
          <span className="spacer" />
          {source?.newPullRequestUrl && <Button text="New pull request" primary href={source.newPullRequestUrl} target="_top" />}
        </div>

        {error && (
          <div className="error-box" role="alert">
            Could not load pull requests: {error}
          </div>
        )}
        {!prs && !error && <div className="loading">Loading pull requests…</div>}

        {prs &&
          shown.map((s) => {
            const isCollapsed = filter === "inbox" && collapsed.has(s.id);
            return (
              <section key={s.id} className={cx("inbox-section", `section-${s.id}`)}>
                <button className="inbox-section-header" onClick={() => (filter === "inbox" ? toggle(s.id) : undefined)} aria-expanded={!isCollapsed}>
                  {filter === "inbox" && <Icon iconName={isCollapsed ? "ChevronRight" : "ChevronDown"} />}
                  <span className="title">{s.title}</span>
                  <span className="count-pill">{s.prs.length}</span>
                </button>
                {!isCollapsed &&
                  (s.prs.length === 0 ? (
                    <p className="inbox-empty muted">{query ? "No matches." : s.empty}</p>
                  ) : (
                    <div role="list" className="pr-rows">
                      {s.prs.map((pr) => {
                        const index = rowIndex++;
                        return (
                          <PrRow
                            key={pr.id}
                            pr={{ ...pr, ...details.get(pr.id) }}
                            me={me.id}
                            via={requestedVia(pr, groupIds).filter(() => !pr.reviewers.some((r) => r.id === me.id && r.vote !== 0))}
                            selected={index === selected}
                            onOpen={() => open(pr)}
                            onHover={() => setSelected(index)}
                          />
                        );
                      })}
                    </div>
                  ))}
              </section>
            );
          })}
        {prs && <p className="hub-footer muted">{plural(visible.length, "pull request")} · j/k to move, Enter to open, / to search</p>}
      </main>
    </div>
  );
};

const SidebarItem: React.FC<{ icon: string; text: string; count: number; active: boolean; attention?: boolean; onClick: () => void }> = ({
  icon,
  text,
  count,
  active,
  attention,
  onClick,
}) => (
  <button className={cx("hub-nav-item", active && "active")} onClick={onClick} aria-current={active ? "page" : undefined}>
    <Icon iconName={icon} />
    <span className="text">{text}</span>
    {count > 0 && <span className={cx("count-pill", attention && "attention")}>{count}</span>}
  </button>
);

const STATE_ICON: Record<string, { icon: string; className: string; label: string }> = {
  draft: { icon: "BranchRequestDraft", className: "state-draft", label: "Draft" },
  active: { icon: "BranchPullRequest", className: "state-active", label: "Active" },
  completed: { icon: "BranchMerged", className: "state-completed", label: "Completed" },
  abandoned: { icon: "BranchRequestClosed", className: "state-abandoned", label: "Abandoned" },
};

function reviewState(pr: PrSummary): { label: string; tone: string } {
  if (pr.status === "completed") return { label: "Merged", tone: "merged" };
  if (pr.status === "abandoned") return { label: "Abandoned", tone: "error" };
  if (pr.isDraft) return { label: "Draft", tone: "neutral" };
  if (pr.reviewers.some((r) => r.vote === -10)) return { label: "Rejected", tone: "error" };
  if (pr.reviewers.some((r) => r.vote === -5)) return { label: "Waiting for author", tone: "warning" };
  if (pr.reviewers.some((r) => r.vote >= 5)) return { label: "Approved", tone: "success" };
  if (pr.reviewers.length === 0) return { label: "No reviewers", tone: "neutral" };
  return { label: "Review pending", tone: "neutral" };
}

const CHECKS: Record<string, { icon: string; tone: string; label: string }> = {
  passing: { icon: "CompletedSolid", tone: "success", label: "Checks passing" },
  failing: { icon: "StatusErrorFull", tone: "error", label: "Checks failing" },
  pending: { icon: "ProgressLoopOuter", tone: "info", label: "Checks running" },
  none: { icon: "CircleRing", tone: "neutral", label: "No checks" },
};

const PrRow: React.FC<{ pr: PrSummary; me: string; via: PrSummary["reviewers"]; selected: boolean; onOpen: () => void; onHover: () => void }> = ({
  pr,
  me,
  via,
  selected,
  onOpen,
  onHover,
}) => {
  const state = STATE_ICON[pr.isDraft && pr.status === "active" ? "draft" : pr.status];
  const review = reviewState(pr);
  const checks = pr.checks ? CHECKS[pr.checks] : null;
  const when = pr.closedDate ?? pr.updatedDate ?? pr.creationDate;
  return (
    <div
      role="listitem"
      tabIndex={-1}
      className={cx("pr-row", selected && "selected", !pr.openable && "not-openable")}
      onClick={onOpen}
      onMouseEnter={onHover}
      title={pr.openable ? undefined : "No local snapshot for this pull request (npm run ext:mock -- <id>)"}
    >
      <span className={cx("pr-state", state.className)} title={state.label}>
        <Icon iconName={state.icon} />
      </span>
      <Avatar who={pr.createdBy} size={24} />
      <div className="pr-main">
        <div className="pr-title">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpen();
            }}
          >
            {pr.title}
          </a>
        </div>
        <div className="pr-sub muted">
          <span>!{pr.id}</span>
          <span>{pr.repository.name}</span>
          <span className="branch-inline">
            {pr.sourceBranch} → {pr.targetBranch}
          </span>
          <span>{pr.createdBy.id === me ? "you" : pr.createdBy.displayName}</span>
          {via.length > 0 && !pr.reviewers.some((r) => r.id === me) && (
            <span className="via-team" title={`Review requested from ${via.map((v) => v.displayName).join(", ")}`}>
              via {via[0].displayName}
              {via.length > 1 ? ` +${via.length - 1}` : ""}
            </span>
          )}
          {pr.labels.slice(0, 3).map((l) => (
            <span key={l} className="label-pill">
              {l}
            </span>
          ))}
        </div>
      </div>
      <span className={cx("review-state", `tone-${review.tone}`)}>{review.label}</span>
      <span className="reviewer-stack" aria-label={`${plural(pr.reviewers.length, "reviewer")}`}>
        {pr.reviewers.slice(0, 4).map((r) => {
          const v = voteInfo(r.vote);
          return (
            <span key={r.id} className="stacked" title={`${r.displayName}: ${v.label}${r.isRequired ? " (required)" : ""}`}>
              <Avatar who={r} size={22} />
              {r.vote !== 0 && <span className={cx("vote-dot", `tone-${v.tone}`)} />}
            </span>
          );
        })}
        {pr.reviewers.length > 4 && <span className="more">+{pr.reviewers.length - 4}</span>}
      </span>
      <span className={cx("pr-checks", checks && `tone-${checks.tone}`)} title={checks?.label ?? "Loading checks…"}>
        {checks ? <Icon iconName={checks.icon} /> : <span className="dot-loading" />}
      </span>
      <span className="pr-comments" title={pr.comments === undefined ? "" : `${plural(pr.comments, "active comment")}`}>
        {pr.comments ? (
          <>
            <Icon iconName="Comment" /> {pr.comments}
          </>
        ) : null}
      </span>
      <span className="pr-size">{pr.size ? <SizeBar {...pr.size} /> : null}</span>
      <span className="pr-time muted" title={when.toLocaleString()}>
        {shortAgo(when)}
      </span>
    </div>
  );
};

const SizeBar: React.FC<{ files: number; adds: number; dels: number }> = ({ files, adds, dels }) => {
  const total = adds + dels;
  const blocks = 5;
  const green = total ? Math.round((adds / total) * blocks) : 0;
  return (
    <span className="size" title={`${plural(files, "file")}, +${adds} −${dels}`}>
      <span className="adds">+{compact(adds)}</span> <span className="dels">−{compact(dels)}</span>
      <span className="size-blocks" aria-hidden="true">
        {Array.from({ length: blocks }, (_, i) => (
          <i key={i} className={i < green ? "add" : i < blocks && total ? "del" : ""} />
        ))}
      </span>
    </span>
  );
};

const compact = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function shortAgo(date: Date): string {
  const text = ago(date);
  const m = /^(\d+) (minute|hour|day|month|year)s? ago$/.exec(text);
  if (!m) return text;
  return `${m[1]}${{ minute: "m", hour: "h", day: "d", month: "mo", year: "y" }[m[2]]}`;
}
