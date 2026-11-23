import * as React from "react";
import { Icon } from "azure-devops-ui/Icon";
import { Button } from "azure-devops-ui/Button";
import type { PrActions, PrOverview, WorkItemRef } from "../data/model";
import { MoreMenu } from "./controls";
import { PresenceAvatar, PresenceStatus, usePresence } from "./presence/Presence";
import { useReviewActions } from "./ReviewActions";
import { useSearch } from "./useSearch";
import { TagPill, useProjectTags } from "./tags/Tags";
import { tagKey } from "../data/tags";
import { Avatar, cx, voteInfo } from "./util";

export const Reviewers: React.FC<{ data: PrOverview }> = ({ data }) => {
  const { actions, disabled, run } = useReviewActions();
  const presence = usePresence();
  const [adding, setAdding] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [required, setRequired] = React.useState(false);
  const { results, searching, error } = useSearch(actions.searchReviewers, adding ? query : "", 2);
  const available = results.filter((who) => !data.pr.reviewers.some((r) => r.id === who.id));
  return (
    <section className="side-section">
      <h3>
        Reviewers{" "}
        <button className="link-button" disabled={disabled} onClick={() => setAdding(!adding)}>
          {adding ? "Cancel" : "Add"}
        </button>
      </h3>
      {adding && (
        <div className="reviewer-picker">
          <input
            aria-label="Search reviewers"
            placeholder="Name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={disabled}
            autoFocus
          />
          <label className="checkbox-label">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} disabled={disabled} /> Required
            reviewer
          </label>
          {searching && (
            <p role="status" className="muted">
              Searching…
            </p>
          )}
          {error && (
            <p role="alert" className="tone-error">
              {error}
            </p>
          )}
          {!searching && !error && query.trim().length >= 2 && !available.length && <p className="muted">No available reviewers found.</p>}
          <ul className="reviewer-results">
            {available.map((who) => (
              <li key={who.id}>
                <button
                  disabled={disabled}
                  onClick={async () => {
                    if (await run(() => actions.addReviewer(who, required))) {
                      setAdding(false);
                      setQuery("");
                    }
                  }}
                >
                  <Avatar who={who} />
                  <span>
                    {who.displayName}
                    <small>{who.uniqueName}</small>
                  </span>
                  <Icon iconName="Add" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!data.pr.reviewers.length && <p className="muted">No reviewers</p>}
      <ul className="people">
        {[...data.pr.reviewers]
          .sort((a, b) => Number(b.isRequired) - Number(a.isRequired))
          .map((r) => {
            const v = voteInfo(r.vote);
            const here = presence.find((p) => p.who.id === r.id);
            return (
              <li key={r.id} className="editable-reviewer">
                <PresenceAvatar who={r} presence={here} />
                <div className="name">
                  {r.displayName}
                  <span className={cx("reviewer-vote", `tone-${v.tone}`)}>
                    {v.icon && <Icon iconName={v.icon} />} {v.label}
                  </span>
                  {here && <PresenceStatus presence={here} />}
                </div>
                {r.isRequired && <span className="tag">Required</span>}
                <MoreMenu
                  label={`Actions for reviewer ${r.displayName}`}
                  disabled={disabled}
                  options={[
                    {
                      id: "required",
                      text: r.isRequired ? "Make optional" : "Make required",
                      icon: r.isRequired ? "Remove" : "Add",
                      onSelect: () => void run(() => actions.setReviewerRequired(r.id, !r.isRequired)),
                    },
                    { id: "remove", text: "Remove reviewer", icon: "Delete", onSelect: () => void run(() => actions.removeReviewer(r.id)) },
                  ]}
                />
              </li>
            );
          })}
      </ul>
    </section>
  );
};

export const Tags: React.FC<{ data: PrOverview }> = ({ data }) => {
  const { actions, disabled, run } = useReviewActions();
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState("");
  const { tags, reload } = useProjectTags();
  const duplicate = data.pr.labels.some((l) => l.toLowerCase() === name.trim().toLowerCase());
  // Offer the project's tags in their own spelling, so "Bug" doesn't become a second "bug".
  const suggestions = tags.filter((t) => !data.pr.labels.some((l) => tagKey(l) === tagKey(t.name)));
  return (
    <section className="side-section">
      <h3>
        Tags{" "}
        <button className="link-button" disabled={disabled} onClick={() => setAdding(!adding)}>
          {adding ? "Cancel" : "Add"}
        </button>
      </h3>
      {adding && (
        <form
          className="tag-editor"
          onSubmit={async (e) => {
            e.preventDefault();
            const existing = tags.find((t) => tagKey(t.name) === tagKey(name));
            if (name.trim() && !duplicate && (await run(() => actions.addTag(existing?.name ?? name)))) {
              reload();
              setAdding(false);
              setName("");
            }
          }}
        >
          <input aria-label="Tag name" list="project-tags" value={name} onChange={(e) => setName(e.target.value)} disabled={disabled} autoFocus />
          <datalist id="project-tags">
            {suggestions.map((t) => (
              <option key={t.name} value={t.name}>
                {t.description}
              </option>
            ))}
          </datalist>
          <Button text="Add tag" primary type="submit" disabled={disabled || !name.trim() || duplicate} />
          {duplicate && <p className="muted">This tag is already added.</p>}
        </form>
      )}
      {data.partial ? (
        <p className="muted">Loading tags…</p>
      ) : !data.pr.labels.length ? (
        <p className="muted">No tags</p>
      ) : (
        <div className="tags">
          {data.pr.labels.map((label) => (
            <TagPill key={label} name={label} className="removable">
              <button
                className="icon-button"
                aria-label={`Remove tag ${label}`}
                disabled={disabled}
                onClick={() => void run(() => actions.removeTag(label))}
              >
                <Icon iconName="Cancel" />
              </button>
            </TagPill>
          ))}
        </div>
      )}
    </section>
  );
};

/** The work items linked to the pull request, with a search to link more by id or title. */
export const WorkItems: React.FC<{ data: PrOverview }> = ({ data }) => {
  const { actions, disabled, run } = useReviewActions();
  const [linking, setLinking] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const { results, searching, error } = useSearch(actions.searchWorkItems, linking ? query : "", 1);
  const [details, remember] = useWorkItemDetails(actions.describeWorkItems, data.partial ? [] : data.workItems.map((w) => w.id));
  const available = results.filter((w) => !data.workItems.some((linked) => linked.id === w.id));
  return (
    <section className="side-section">
      <h3>
        Work items{" "}
        <button className="link-button" disabled={disabled} onClick={() => setLinking(!linking)}>
          {linking ? "Cancel" : "Link"}
        </button>
      </h3>
      {linking && (
        <div className="reviewer-picker">
          <input
            aria-label="Search work items"
            placeholder="ID or title"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={disabled}
            autoFocus
          />
          {searching && (
            <p role="status" className="muted">
              Searching…
            </p>
          )}
          {error && (
            <p role="alert" className="tone-error">
              {error}
            </p>
          )}
          {!searching && !error && !!query.trim() && !available.length && <p className="muted">No work items found.</p>}
          <ul className="reviewer-results">
            {available.map((w) => (
              <li key={w.id}>
                <button
                  disabled={disabled}
                  onClick={async () => {
                    // Known now, so the linked row shows its title as soon as the page refreshes.
                    remember(w);
                    if (await run(() => actions.linkWorkItem(w.id))) {
                      setLinking(false);
                      setQuery("");
                    }
                  }}
                >
                  <Icon iconName="WorkItem" />
                  <span>
                    #{w.id} {w.title}
                    <small>{[w.type, w.state].filter(Boolean).join(" · ")}</small>
                  </span>
                  <Icon iconName="Link" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.partial ? (
        <p className="muted">Loading work items…</p>
      ) : !data.workItems.length ? (
        <p className="muted">No work items linked</p>
      ) : (
        <ul className="work-items">
          {data.workItems.map((ref) => {
            const w = details.get(ref.id) ?? ref;
            return (
              <li key={ref.id}>
                <Icon iconName="WorkItem" />
                <span className="name">
                  {/* _top leaves Azure DevOps' iframe for the work item's own page. */}
                  {w.url ? (
                    <a href={w.url} target="_top">
                      #{w.id}
                    </a>
                  ) : (
                    `#${w.id}`
                  )}{" "}
                  {w.title}
                  {w.state && <span className="muted"> · {w.state}</span>}
                </span>
                <button
                  className="icon-button"
                  aria-label={`Unlink work item ${ref.id}`}
                  title="Unlink"
                  disabled={disabled}
                  onClick={() => void run(() => actions.unlinkWorkItem(ref.id))}
                >
                  <Icon iconName="Cancel" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

/**
 * The titles, types, states and pages of the linked work items, read after the page's load so the page doesn't wait
 * for them. Until they're in, or if they can't be read, the card lists the ids. `remember` adds one already known
 * (a search result being linked), so its row shows the title at once.
 */
function useWorkItemDetails(describe: PrActions["describeWorkItems"], ids: string[]) {
  const key = ids.join(",");
  const [details, setDetails] = React.useState(() => new Map<string, WorkItemRef>());
  React.useEffect(() => {
    if (!key) return;
    let cancelled = false;
    describe(key.split(",")).then(
      (found) => !cancelled && setDetails((known) => new Map([...known, ...found.map((w) => [w.id, w] as const)])),
      (e) => console.warn("[review-deck] work item details unavailable:", e),
    );
    return () => void (cancelled = true);
  }, [describe, key]);
  const remember = React.useCallback((w: WorkItemRef) => setDetails((known) => new Map(known).set(w.id, w)), []);
  return [details, remember] as const;
}
