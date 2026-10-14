// The pull request page's "⋯" menu, with the native Azure DevOps page's items in its order. Merge previews have no
// public API, so those items open the native page.
import { Button } from "azure-devops-ui/Button";
import { Icon } from "azure-devops-ui/Icon";
import * as React from "react";
import type { Identity, PullRequest } from "../data/model";
import { MoreMenu, type MenuOption } from "./controls";
import { ModalDialog } from "./ModalDialog";
import { useReviewActions } from "./ReviewActions";
import { useSearch } from "./useSearch";
import { Avatar, cx } from "./util";

/** Links the menu offers, from the host. */
export interface PrMenuLinks {
  /** This pull request in Review Deck. */
  review: string;
  /** The native Azure DevOps pull request page. */
  native: string | null;
  createPr: (source: string, target: string) => string | null;
}

type Dialog = "share" | "target" | "cherry-pick";
/** Branch pickers show this many matches; typing narrows them. */
const MAX_BRANCHES = 50;

export const PrMenu: React.FC<{ pr: PullRequest; links: PrMenuLinks; onToast: (message: string) => void }> = ({ pr, links, onToast }) => {
  const { actions, disabled, run } = useReviewActions();
  const [dialog, setDialog] = React.useState<Dialog | null>(null);
  // Null while unknown: the item still offers to follow (or favorite), as the native menu does.
  const [following, setFollowing] = React.useState<boolean | null>(null);
  const [favorite, setFavorite] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    actions.isFollowing().then(setFollowing, (e: Error) => console.warn("[review-deck] follow state unavailable:", e));
  }, [actions]);
  React.useEffect(() => {
    actions.isFavoriteBranch(pr.sourceBranch).then(setFavorite, (e: Error) => console.warn("[review-deck] favorite branches unavailable:", e));
  }, [actions, pr.sourceBranch]);

  const copy = (url: string, what: string) =>
    navigator.clipboard?.writeText(url).then(
      () => onToast(`${what} copied.`),
      () => onToast(`Could not copy the ${what.toLowerCase()}.`),
    );
  const toggleFollow = async () => {
    const on = !following;
    if (await run(() => actions.setFollowing(on))) {
      setFollowing(on);
      onToast(on ? "You'll be notified about changes to this pull request." : "You stopped following this pull request.");
    }
  };
  const toggleFavorite = async () => {
    const on = !favorite;
    if (await run(() => actions.setFavoriteBranch(pr.sourceBranch, on))) {
      setFavorite(on);
      onToast(on ? `${pr.sourceBranch} added to your favorite branches.` : `${pr.sourceBranch} removed from your favorite branches.`);
    }
  };

  const active = pr.status === "active";
  const native = links.native ?? undefined;
  const options: MenuOption[] = [
    { id: "share", text: "Share pull request", icon: "Share", disabled, onSelect: () => setDialog("share") },
    { id: "copy-review", text: "Copy Review Deck link", icon: "Link", onSelect: () => copy(links.review, "Review Deck link") },
    ...(native ? [{ id: "copy-native", text: "Copy pull request link", icon: "Link", onSelect: () => copy(native, "Pull request link") }] : []),
    { id: "d1", text: "", divider: true },
    { id: "follow", text: following ? "Unfollow" : "Follow", icon: following ? "RingerOff" : "Ringer", disabled, onSelect: toggleFollow },
    { id: "d2", text: "", divider: true },
    ...(native && active
      ? [
          { id: "merge-changes", text: "View merge changes", icon: "BranchCompare", secondaryText: "Azure DevOps", href: native },
          { id: "restart-merge", text: "Restart merge", icon: "BranchMerge", secondaryText: "Azure DevOps", href: native },
        ]
      : []),
    {
      id: "favorite",
      text: favorite ? "Remove source branch from favorites" : "Add source branch to favorites",
      icon: favorite ? "Unfavorite" : "FavoriteStar",
      disabled,
      onSelect: toggleFavorite,
    },
    ...(active ? [{ id: "target", text: "Change target branch", icon: "BranchFork2", disabled, onSelect: () => setDialog("target") }] : []),
    { id: "cherry-pick", text: "Cherry-pick", icon: "BranchCommit", disabled, onSelect: () => setDialog("cherry-pick") },
  ];

  const close = () => setDialog(null);
  return (
    <>
      <MoreMenu label="More actions" subtle={false} options={options} />
      {dialog === "share" && <ShareDialog onClose={close} onDone={onToast} />}
      {dialog === "target" && <ChangeTargetDialog pr={pr} onClose={close} onDone={onToast} />}
      {dialog === "cherry-pick" && <CherryPickDialog pr={pr} createPr={links.createPr} onClose={close} />}
    </>
  );
};

const ShareDialog: React.FC<{ onClose: () => void; onDone: (message: string) => void }> = ({ onClose, onDone }) => {
  const { actions } = useReviewActions();
  const [query, setQuery] = React.useState("");
  const [people, setPeople] = React.useState<Identity[]>([]);
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { results, searching, error: searchError } = useSearch(actions.searchReviewers, query, 2);
  const available = results.filter((who) => !people.some((p) => p.id === who.id));
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await actions.share(people, message);
      onDone(people.length === 1 ? `Shared with ${people[0].displayName}.` : `Shared with ${people.length} people.`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <ModalDialog title="Share pull request" icon="Share" className="pr-menu-dialog" onClose={onClose}>
      <p className="muted">Azure DevOps emails them a link to this pull request.</p>
      {people.length > 0 && (
        <ul className="share-people" aria-label="Recipients">
          {people.map((p) => (
            <li key={p.id}>
              <Avatar who={p} size={20} />
              {p.displayName}
              <button className="modal-close" aria-label={`Remove ${p.displayName}`} onClick={() => setPeople(people.filter((x) => x.id !== p.id))}>
                <Icon iconName="Cancel" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="modal-field">
        To
        <input placeholder="Name or email" value={query} onChange={(e) => setQuery(e.target.value)} disabled={busy} autoFocus />
      </label>
      {searching && <p className="muted" role="status">Searching…</p>}
      {searchError && <p className="tone-error" role="alert">{searchError}</p>}
      {!searching && !searchError && query.trim().length >= 2 && !available.length && <p className="muted">No one found.</p>}
      <ul className="reviewer-results">
        {available.slice(0, 8).map((who) => (
          <li key={who.id}>
            <button
              onClick={() => {
                setPeople([...people, who]);
                setQuery("");
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
      <label className="modal-field">
        Message
        <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} disabled={busy} placeholder="Optional" />
      </label>
      <DialogFooter error={error} onCancel={onClose}>
        <Button text={busy ? "Sharing…" : "Share"} primary disabled={busy || !people.length} onClick={submit} />
      </DialogFooter>
    </ModalDialog>
  );
};

/** A searchable list of this repository's branches; one is picked. */
const BranchPicker: React.FC<{ label: string; value: string; exclude?: string[]; disabled?: boolean; onChange: (branch: string) => void }> = ({
  label,
  value,
  exclude = [],
  disabled,
  onChange,
}) => {
  const { actions } = useReviewActions();
  const [query, setQuery] = React.useState("");
  const { results, searching, error } = useSearch(actions.searchBranches, query, 0);
  const shown = results.filter((b) => !exclude.includes(b)).slice(0, MAX_BRANCHES);
  return (
    <div className="branch-picker">
      <label className="modal-field">
        {label}
        <input placeholder="Search branches" value={query} onChange={(e) => setQuery(e.target.value)} disabled={disabled} autoFocus />
      </label>
      {error && <p className="tone-error" role="alert">{error}</p>}
      <ul className="branch-results" role="listbox" aria-label={label} aria-busy={searching}>
        {shown.map((b) => (
          <li key={b} role="option" aria-selected={b === value}>
            <button className={cx(b === value && "selected")} disabled={disabled} onClick={() => onChange(b)}>
              <Icon iconName="OpenSource" />
              <span className="branch-name">{b}</span>
              {b === value && <Icon iconName="CheckMark" />}
            </button>
          </li>
        ))}
        {!searching && !error && !shown.length && <li className="muted">No branches found.</li>}
      </ul>
    </div>
  );
};

const ChangeTargetDialog: React.FC<{ pr: PullRequest; onClose: () => void; onDone: (message: string) => void }> = ({ pr, onClose, onDone }) => {
  const { actions, disabled, run } = useReviewActions();
  const [target, setTarget] = React.useState("");
  // Closes either way: a failure shows in the page's write feedback, with a refresh button.
  const submit = async () => {
    if (await run(() => actions.changeTarget(target))) onDone(`The pull request now targets ${target}.`);
    onClose();
  };
  return (
    <ModalDialog title="Change target branch" icon="BranchFork2" className="pr-menu-dialog" onClose={onClose}>
      <p className="muted">
        Currently merging <span className="branch">{pr.sourceBranch}</span> into <span className="branch">{pr.targetBranch}</span>.
      </p>
      <BranchPicker label="New target branch" value={target} exclude={[pr.sourceBranch, pr.targetBranch]} disabled={disabled} onChange={setTarget} />
      <DialogFooter onCancel={onClose}>
        <Button text={disabled ? "Changing…" : "Change target"} primary disabled={disabled || !target} onClick={submit} />
      </DialogFooter>
    </ModalDialog>
  );
};

const topicFor = (pr: PullRequest, onto: string) => `cherry-pick-${pr.id}-to-${onto.replace(/[^\w.-]+/g, "-")}`;

const CherryPickDialog: React.FC<{ pr: PullRequest; createPr: PrMenuLinks["createPr"]; onClose: () => void }> = ({ pr, createPr, onClose }) => {
  const { actions } = useReviewActions();
  const [onto, setOnto] = React.useState(pr.targetBranch);
  const [topic, setTopic] = React.useState(topicFor(pr, pr.targetBranch));
  // The topic follows the target until it's edited.
  const [topicEdited, setTopicEdited] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ topic: string; onto: string } | null>(null);
  const pick = (branch: string) => {
    setOnto(branch);
    if (!topicEdited) setTopic(topicFor(pr, branch));
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await actions.cherryPick(onto, topic.trim());
      setDone({ topic: topic.trim(), onto });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (done) {
    const url = createPr(done.topic, done.onto);
    return (
      <ModalDialog title="Cherry-pick" icon="BranchCommit" className="pr-menu-dialog" onClose={onClose}>
        <p>
          <Icon iconName="CompletedSolid" className="tone-success" /> The changes are on <span className="branch">{done.topic}</span>, branched from{" "}
          <span className="branch">{done.onto}</span>.
        </p>
        <DialogFooter onCancel={onClose} cancelText="Close">
          {url && <Button text="Create pull request" primary href={url} target="_top" />}
        </DialogFooter>
      </ModalDialog>
    );
  }
  return (
    <ModalDialog title="Cherry-pick" icon="BranchCommit" className="pr-menu-dialog" onClose={onClose}>
      <p className="muted">Applies this pull request's changes to another branch, in a new branch you can open a pull request from.</p>
      <BranchPicker label="Target branch" value={onto} exclude={[pr.sourceBranch]} disabled={busy} onChange={pick} />
      <label className="modal-field">
        New branch
        <input
          value={topic}
          disabled={busy}
          onChange={(e) => {
            setTopic(e.target.value);
            setTopicEdited(true);
          }}
        />
      </label>
      <DialogFooter error={error} onCancel={onClose}>
        <Button text={busy ? "Cherry-picking…" : "Cherry-pick"} primary disabled={busy || !onto || !topic.trim()} onClick={submit} />
      </DialogFooter>
    </ModalDialog>
  );
};

const DialogFooter: React.FC<{ error?: string | null; onCancel: () => void; cancelText?: string }> = ({ error, onCancel, cancelText = "Cancel", children }) => (
  <>
    {error && (
      <p className="tone-error" role="alert">
        {error}
      </p>
    )}
    <footer className="modal-actions">
      <Button text={cancelText} onClick={onCancel} />
      {children}
    </footer>
  </>
);
