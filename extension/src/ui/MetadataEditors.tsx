import * as React from "react";
import { Icon } from "azure-devops-ui/Icon";
import { Button } from "azure-devops-ui/Button";
import type { Identity, PrOverview } from "../data/model";
import { MoreMenu } from "./controls";
import { useReviewActions } from "./ReviewActions";
import { TagPill, useProjectTags } from "./tags/Tags";
import { tagKey } from "../data/tags";
import { Avatar, cx, voteInfo } from "./util";

export const Reviewers: React.FC<{ data: PrOverview }> = ({ data }) => {
  const { actions, disabled, run } = useReviewActions();
  const [adding, setAdding] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Identity[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [required, setRequired] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    setResults([]);
    setError(null);
    if (!adding || query.trim().length < 2) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      actions
        .searchReviewers(query)
        .then((people) => {
          if (!cancelled) setResults(people);
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [actions, query, adding]);
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
            return (
              <li key={r.id} className="editable-reviewer">
                <Avatar who={r} />
                <div className="name">
                  {r.displayName}
                  <span className={cx("reviewer-vote", `tone-${v.tone}`)}>
                    {v.icon && <Icon iconName={v.icon} />} {v.label}
                  </span>
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
      {!data.pr.labels.length ? (
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
