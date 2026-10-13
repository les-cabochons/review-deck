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
import { CHECKS, reviewState, STATE_ICON } from "../prState";
import { stackFor, stackIndex, type StackPosition } from "../../../../src/stack/stacks";
import { readPreference, writePreference } from "../preferences";
import { StackDialog } from "../stack/StackDialog";
import { ALL_PROJECTS, type ListScope, parseSelection, type RepoCatalog, type RepoSelection, selectionScope } from "../../data/repoSelection";
import { tagKey } from "../../data/tags";
import { SidebarTags, TagPill, useProjectTags } from "../tags/Tags";
import { RepoPicker } from "./RepoPicker";
import { ago, Avatar, cx, plural, voteInfo } from "../util";

type Filter = "inbox" | SectionId;

/** The PR hub: a Graphite-style inbox of pull requests that involve you, in an Azure DevOps skin. */
export const HubPage: React.FC<{ host: AppHost }> = ({ host }) => {
  const [source, setSource] = React.useState<PrListSource | null>(null);
  const [prs, setPrs] = React.useState<PrSummary[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  // Null until the saved choice, or on a first visit the Repos breadcrumb's repository, is known.
  const [selection, setSelection] = React.useState<RepoSelection | null>(null);
  const [catalog, setCatalog] = React.useState<RepoCatalog | null>(null);
  const [catalogError, setCatalogError] = React.useState<string | null>(null);
  const [favorites, setFavorites] = React.useState<string[] | null>(null);
  const [tag, setTag] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<Filter>(() => readPreference<Filter>("hub.filter", "inbox"));
  const [collapsed, setCollapsed] = React.useState<Set<SectionId>>(() => new Set(JSON.parse(readPreference("hub.collapsed", '["other"]')) as SectionId[]));
  // Empty sections start closed; opening one only lasts until reload.
  const [openedEmpty, setOpenedEmpty] = React.useState<Set<SectionId>>(new Set());
  const [details, setDetails] = React.useState<Map<number, Partial<PrSummary>>>(new Map());
  const [selected, setSelected] = React.useState(0);
  const search = React.useRef<HTMLInputElement>(null);

  const [groups, setGroups] = React.useState<MyGroup[]>([]);
  const [trunks, setTrunks] = React.useState<string[] | null>(null);
  React.useEffect(() => {
    host.projectSettings().then((s) => setTrunks(s.trunkBranches));
  }, [host]);
  const stacks = React.useMemo(() => (prs && trunks ? stackIndex(prs, trunks) : new Map()), [prs, trunks]);
  const [groupError, setGroupError] = React.useState<string | null>(null);
  const [stackOpen, setStackOpen] = React.useState<StackPosition<PrSummary> | null>(null);
  const showStack = (pr: PrSummary) => prs && trunks && setStackOpen(stackFor(pr, prs, trunks));
  const closeStack = React.useCallback(() => setStackOpen(null), []);

  React.useEffect(() => {
    host.listSource().then(setSource, (e: Error) => setError(e.message));
    host.favoriteRepos().load().then(setFavorites);
  }, [host]);
  React.useEffect(() => {
    if (!source) return;
    source.catalog().then(setCatalog, (e: Error) => setCatalogError(e.message));
    const saved = parseSelection(readPreference("hub.selection", ""));
    if (saved) setSelection(saved);
    else
      host
        .currentRepository()
        .catch(() => null)
        .then((r) => setSelection(r ? { ...ALL_PROJECTS, repos: [r.id] } : { ...ALL_PROJECTS, projects: [source.currentProjectId] }));
  }, [host, source]);
  const scope = selection && favorites ? selectionScope(selection, favorites) : null;
  // A string, so effects rerun only when the queries change.
  const scopeKey = scope && JSON.stringify(scope);

  const { reload: reloadTags, revision: tagRevision, byKey: tagsByKey } = useProjectTags();
  // Drop the tag filter when that tag is renamed or deleted.
  React.useEffect(() => {
    if (tag && tagsByKey.size && !tagsByKey.has(tagKey(tag))) setTag(null);
  }, [tag, tagsByKey]);
  const request = React.useRef(0);
  const loadPrs = React.useCallback(() => {
    if (!source || !scopeKey) return;
    const id = ++request.current;
    setError(null);
    // Teams only widen "Needs your review"; the list still works without them.
    Promise.all([
      source.list(JSON.parse(scopeKey) as ListScope),
      source.myGroups().then(
        (g) => {
          setGroups(g);
          setGroupError(null);
        },
        (e: Error) => setGroupError(e.message),
      ),
    ])
      // A slower answer for an earlier selection must not replace the current one.
      .then(([list]) => id === request.current && setPrs(list))
      .catch((e: Error) => id === request.current && setError(e.message));
  }, [source, scopeKey]);
  const load = () => {
    reloadTags();
    loadPrs();
  };
  React.useEffect(() => {
    setPrs(null);
  }, [scopeKey]);
  // Also after a tag is renamed or deleted, so rows show the new names.
  React.useEffect(() => {
    loadPrs();
  }, [loadPrs, tagRevision]);
  React.useEffect(() => {
    host.setTitle("Pull requests");
  }, [host]);

  const pick = (next: RepoSelection) => {
    setSelection(next);
    writePreference("hub.selection", JSON.stringify(next));
  };
  const toggleFavorite = (repoId: string) => {
    const before = favorites ?? [];
    const next = before.includes(repoId) ? before.filter((f) => f !== repoId) : [...before, repoId];
    setFavorites(next);
    host
      .favoriteRepos()
      .save(next)
      .catch((e) => {
        console.warn("[semantic-pr] could not save favorite repositories:", e);
        setFavorites(before);
      });
  };

  const me = host.currentUser;
  const visible = (prs ?? [])
    .filter((p) => (!tag || p.labels.some((l) => tagKey(l) === tagKey(tag))) && matchesQuery(p, query))
    .map((p) => ({ ...p, ...details.get(p.id) }));
  const tagCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of prs ?? []) if (p.status === "active") for (const l of p.labels) counts.set(tagKey(l), (counts.get(tagKey(l)) ?? 0) + 1);
    return counts;
  }, [prs]);
  const groupIds = React.useMemo(() => new Set(groups.map((g) => g.id)), [groups]);
  const sections = inboxSections(visible, me, groupIds);
  const shown = sections.filter((s) => filter === "inbox" || s.id === filter);
  const rows = shown.flatMap((s) => (collapsed.has(s.id) && filter === "inbox" ? [] : s.prs));

  // Lazily enrich visible rows (checks, comment counts) where the host needs extra calls per PR. Your open PRs
  // come first even when collapsed: their reviewer policies decide between Approved and Waiting for review.
  const enrich = [...new Map([...visible.filter((p) => p.createdBy.id === me.id && p.status === "active" && !p.isDraft), ...rows].map((p) => [p.id, p])).values()];
  React.useEffect(() => {
    if (!source?.details) return;
    let cancelled = false;
    const todo = enrich.filter((p) => !details.has(p.id)).slice(0, 24);
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
  }, [source, enrich.map((r) => r.id).join(",")]);

  const open = (pr: PrSummary) => pr.openable && host.navigate({ view: "pr", repo: pr.repository.id, pr: pr.id, project: pr.repository.projectName });
  // Keyboard: "/" search, j/k or arrows to move, Enter or o to open.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (stackOpen) return;
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
  }, [filter, query, scopeKey, tag]);
  React.useEffect(() => {
    document.querySelector(".pr-row.selected")?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const choose = (f: Filter) => {
    setFilter(f);
    writePreference("hub.filter", f);
  };
  const isCollapsed = (s: { id: SectionId; prs: PrSummary[] }) => collapsed.has(s.id) || (s.prs.length === 0 && !openedEmpty.has(s.id));
  const toggle = (s: { id: SectionId; prs: PrSummary[] }) => {
    if (s.prs.length === 0 && !collapsed.has(s.id)) {
      const next = new Set(openedEmpty);
      if (next.has(s.id)) next.delete(s.id);
      else next.add(s.id);
      setOpenedEmpty(next);
      return;
    }
    const next = new Set(collapsed);
    if (next.has(s.id)) next.delete(s.id);
    else next.add(s.id);
    setCollapsed(next);
    writePreference("hub.collapsed", JSON.stringify([...next]));
  };

  let rowIndex = 0;
  return (
    <div className="hub">
      <aside className="hub-sidebar">
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
        <div className="hub-sidebar-sep" />
        <SidebarTags counts={tagCounts} active={tag} onSelect={setTag} />
        {groupError && (
          <p className="hub-sidebar-note tone-warning" role="status">
            Couldn't load your teams, so only reviews assigned to you directly are counted. {groupError}
          </p>
        )}
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
          {selection && (
            <RepoPicker
              catalog={catalog}
              catalogError={catalogError}
              selection={selection}
              onChange={pick}
              favorites={favorites ?? []}
              onToggleFavorite={toggleFavorite}
            />
          )}
          <Button iconProps={{ iconName: "Refresh" }} subtle ariaLabel="Refresh" onClick={load} />
          <span className="spacer" />
          {source?.newPullRequestUrl && <Button text="New pull request" primary href={source.newPullRequestUrl} target="_top" />}
        </div>

        {error && (
          <div className="error-box" role="alert">
            Could not load pull requests: {error}
          </div>
        )}
        {!prs && !error && <div className="loading">{scope === "organization" ? "Loading pull requests from every project…" : "Loading pull requests…"}</div>}

        {prs &&
          shown.map((s) => {
            const closed = filter === "inbox" && isCollapsed(s);
            return (
              <section key={s.id} className={cx("inbox-section", `section-${s.id}`)}>
                <button className="inbox-section-header" onClick={() => (filter === "inbox" ? toggle(s) : undefined)} aria-expanded={!closed}>
                  {filter === "inbox" && <Icon iconName={closed ? "ChevronRight" : "ChevronDown"} />}
                  <span className="title">{s.title}</span>
                  <span className="count-pill">{s.prs.length}</span>
                </button>
                {!closed &&
                  (s.prs.length === 0 ? (
                    <p className="inbox-empty muted">{query ? "No matches." : s.empty}</p>
                  ) : (
                    <div role="list" className="pr-rows">
                      {s.prs.map((pr) => {
                        const index = rowIndex++;
                        return (
                          <PrRow
                            key={pr.id}
                            pr={pr}
                            me={me.id}
                            via={requestedVia(pr, groupIds).filter(() => !pr.reviewers.some((r) => r.id === me.id && r.vote !== 0))}
                            stack={stacks.get(pr.id)}
                            selected={index === selected}
                            onOpen={() => open(pr)}
                            onStack={() => showStack(pr)}
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
      {stackOpen && (
        <StackDialog
          position={stackOpen}
          details={details}
          onClose={closeStack}
          onOpen={(pr) => {
            setStackOpen(null);
            open(pr);
          }}
        />
      )}
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
    <Icon iconName={icon} className="hub-nav-icon" />
    <span className="text">{text}</span>
    {count > 0 && <span className={cx("count-pill", attention && "attention")}>{count}</span>}
  </button>
);


const PrRow: React.FC<{
  pr: PrSummary;
  me: string;
  via: PrSummary["reviewers"];
  /** Position in a stack ("2 of 4"), if the PR is stacked. */
  stack?: { index: number; size: number; bottomId: number };
  selected: boolean;
  onOpen: () => void;
  /** Show the whole stack, from the stack chip. */
  onStack: () => void;
  onHover: () => void;
}> = ({ pr, me, via, stack, selected, onOpen, onStack, onHover }) => {
  const state = STATE_ICON[pr.isDraft && pr.status === "active" ? "draft" : pr.status];
  const review = reviewState(pr);
  const checks = pr.checks ? CHECKS[pr.checks] : null;
  const when = pr.closedDate ?? pr.updatedDate ?? pr.creationDate;
  const stackChip = stack && (
    <button
      className={cx("stack-chip", pr.restack?.state === "failed" && "warn")}
      title={`Layer ${stack.index} of ${stack.size} in a stack (bottom: !${stack.bottomId})${pr.restack?.state === "failed" ? `. ${pr.restack.description}` : ""}. Click to see the whole stack.`}
      onClick={(e) => {
        e.stopPropagation();
        onStack();
      }}
    >
      <Icon iconName="BranchFork2" /> {stack.index}/{stack.size}
    </button>
  );
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
      <Avatar who={pr.createdBy} size={32} />
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
          {/* Like GitHub: tags follow the title and wrap with it, never truncated. */}
          {pr.labels.map((l) => (
            <TagPill key={l} name={l} />
          ))}
        </div>
        {/* Azure DevOps' own wording: "Alex Trépanier requested !1 into main". */}
        {/* The stack chip leads, so a narrow row clips the end of the line rather than the chip. */}
        <div className="pr-sub muted">
          {stackChip}
          <span className="pr-request" title={`${pr.sourceBranch} → ${pr.targetBranch}`}>
            <span className="who">{pr.createdBy.id === me ? "You" : pr.createdBy.displayName}</span>
            <span className="requested">requested !{pr.id} into</span>
            <Icon iconName="OpenSource" className="branch-icon" />
            <span className="branch-inline">{pr.targetBranch}</span>
          </span>
          <span className="pr-repo">{pr.repository.name}</span>
          {via.length > 0 && !pr.reviewers.some((r) => r.id === me) && (
            <span className="via-team" title={`Review requested from ${via.map((v) => v.displayName).join(", ")}`}>
              via {via[0].displayName}
              {via.length > 1 ? ` +${via.length - 1}` : ""}
            </span>
          )}
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
        {pr.status === "completed" ? "Completed" : pr.status === "abandoned" ? "Abandoned" : "Updated"} {shortAgoPhrase(when)}
      </span>
      {/* Phone layout (styles.css, max-width 700px), like T3 Code's PR list: who and where, the full title, then tags and size. */}
      <div className="pr-mobile">
        <div className="m-top">
          <Avatar who={pr.createdBy} size={20} />
          <span className="m-where">
            {pr.repository.name} !{pr.id}
          </span>
          {stackChip}
          <span className="m-time" title={when.toLocaleString()}>
            {shortAgo(when)}
          </span>
        </div>
        <div className="m-title">
          {pr.title}
          {pr.labels.map((l) => (
            <TagPill key={l} name={l} />
          ))}
        </div>
        <div className="m-bottom">
          <span className="m-tags">
          <span className={cx("m-review", `tone-${review.tone}`)}>{review.label}</span>
          {checks && checks !== CHECKS.none && (
            <span className={`tone-${checks.tone}`} title={checks.label}>
              <Icon iconName={checks.icon} />
            </span>
          )}
          {!!pr.comments && (
            <span className="muted">
              <Icon iconName="Comment" /> {pr.comments}
            </span>
          )}
          </span>
          {pr.size && (
            <span className="m-size">
              <span className="adds">+{pr.size.adds.toLocaleString()}</span> <span className="dels">−{pr.size.dels.toLocaleString()}</span>
            </span>
          )}
        </div>
      </div>
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

/** "20h ago", or the long form when there's no short one ("just now"). */
function shortAgoPhrase(date: Date): string {
  const short = shortAgo(date);
  return /^[0-9]/.test(short) ? `${short} ago` : short;
}

function shortAgo(date: Date): string {
  const text = ago(date);
  const m = /^(\d+) (minute|hour|day|month|year)s? ago$/.exec(text);
  if (!m) return text;
  return `${m[1]}${{ minute: "m", hour: "h", day: "d", month: "mo", year: "y" }[m[2]]}`;
}
