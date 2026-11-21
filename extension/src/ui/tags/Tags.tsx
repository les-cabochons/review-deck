import { Button } from "azure-devops-ui/Button";
import { ContentSize } from "azure-devops-ui/Callout";
import { Icon } from "azure-devops-ui/Icon";
import { Panel } from "azure-devops-ui/Panel";
import * as React from "react";
import type { AppHost } from "../../app/host";
import {
  defaultTagColor,
  parseColor,
  parseHiddenTags,
  randomTagColor,
  serializeHiddenTags,
  sidebarTags,
  TAG_COLORS,
  type TagDef,
  tagKey,
  tagNameError,
  tagPillStyle,
  tagTextColor,
  withTagHidden,
} from "../../data/tags";
import { usePierreTheme } from "../pierre/theme";
import { usePreference } from "../usePreference";
import { cx, plural } from "../util";

interface ProjectTags {
  tags: TagDef[];
  /** By tagKey(name). */
  byKey: Map<string, TagDef>;
  reload: () => void;
  /** Bumped when a tag is renamed or deleted here, so lists showing tags refetch. */
  revision: number;
  /** Call after renaming or deleting a tag. */
  changed: () => void;
  /** The host's theme is dark: pills use GitHub's dark-mode tints. */
  dark: boolean;
  host: AppHost | null;
  /**
   * Tags you hid from the hub sidebar, by tagKey(name). Yours only, unlike colors and descriptions: saved
   * with your synced preferences, one list per project. Pull requests still show these tags.
   */
  hidden: Set<string>;
  /** Hides or shows `name` in your sidebar. With `previous`, `name` is that tag's new name (data/tags.ts withTagHidden). */
  setTagHidden: (name: string, hide: boolean, previous?: string) => void;
}

const TagContext = React.createContext<ProjectTags>({
  tags: [],
  byKey: new Map(),
  reload: () => {},
  revision: 0,
  changed: () => {},
  dark: false,
  host: null,
  hidden: new Set(),
  setTagHidden: () => {},
});
export const useProjectTags = () => React.useContext(TagContext);

/** Loads the project's tags once for both pages; editors call reload() after a change. */
export const ProjectTagsProvider: React.FC<{ host: AppHost; children: React.ReactNode }> = ({ host, children }) => {
  const [tags, setTags] = React.useState<TagDef[]>([]);
  const reload = React.useCallback(() => {
    host
      .tags()
      .list()
      .then(setTags, (e) => console.warn("[review-deck] tags unavailable:", e));
  }, [host]);
  React.useEffect(reload, [reload]);
  const [revision, setRevision] = React.useState(0);
  const changed = React.useCallback(() => {
    reload();
    setRevision((r) => r + 1);
  }, [reload]);
  const dark = usePierreTheme() === "dark";
  const [savedHidden, setSavedHidden] = usePreference<string>(`tags.hidden.${host.projectId}`, "");
  const hidden = React.useMemo(() => parseHiddenTags(savedHidden), [savedHidden]);
  // Changes build on the latest list, not the one a caller rendered with: a delete awaits the server, and a
  // Hide clicked meanwhile must survive the delete's own update.
  const latestHidden = React.useRef(hidden);
  latestHidden.current = hidden;
  const setTagHidden = React.useCallback(
    (name: string, hide: boolean, previous?: string) => {
      const next = withTagHidden(latestHidden.current, name, hide, previous);
      // No change, no save: deleting a tag you never hid shouldn't write your preferences.
      if (serializeHiddenTags(next) === serializeHiddenTags(latestHidden.current)) return;
      latestHidden.current = next;
      setSavedHidden(serializeHiddenTags(next));
    },
    [setSavedHidden],
  );
  const value = React.useMemo(
    () => ({ tags, byKey: new Map(tags.map((t) => [tagKey(t.name), t])), reload, revision, changed, dark, host, hidden, setTagHidden }),
    [tags, reload, revision, changed, dark, host, hidden, setTagHidden],
  );
  return <TagContext.Provider value={value}>{children}</TagContext.Provider>;
};

/** A tag in its color, like a GitHub label. */
export const TagPill: React.FC<{ name: string; color?: string; className?: string; title?: string; children?: React.ReactNode }> = ({
  name,
  color,
  className,
  title,
  children,
}) => {
  const { byKey, dark } = useProjectTags();
  const tag = byKey.get(tagKey(name));
  return (
    <span className={cx("label-pill", "tag-pill", className)} style={tagPillStyle(color ?? tag?.color ?? defaultTagColor(name), dark)} title={title ?? (tag?.description || undefined)}>
      {name}
      {children}
    </span>
  );
};

/** Hub sidebar: every tag you haven't hidden, with its open pull request count; a click filters the list. */
export const SidebarTags: React.FC<{ counts: Map<string, number>; active: string | null; onSelect: (name: string | null) => void }> = ({ counts, active, onSelect }) => {
  const { tags, hidden } = useProjectTags();
  const [managing, setManaging] = React.useState(false);
  const shown = sidebarTags(tags, hidden, active);
  const hiddenCount = tags.filter((t) => hidden.has(tagKey(t.name))).length;
  return (
    <section className="hub-tags" aria-label="Tags">
      <div className="hub-tags-head">
        <span>Tags</span>
        <button className="link-button" onClick={() => setManaging(true)}>
          <Icon iconName="Edit" /> Manage
        </button>
      </div>
      {tags.length === 0 ? (
        <p className="hub-sidebar-note muted">No tags yet.</p>
      ) : (
        <ul className="hub-tag-list">
          {shown.map((t) => {
            const isActive = active !== null && tagKey(active) === tagKey(t.name);
            return (
              <li key={t.name}>
                <button className={cx("hub-tag", isActive && "active")} aria-pressed={isActive} onClick={() => onSelect(isActive ? null : t.name)} title={t.description || t.name}>
                  <span className="tag-dot" style={{ background: t.color }} />
                  <span className="text">{t.name}</span>
                  {!!counts.get(tagKey(t.name)) && <span className="count">{counts.get(tagKey(t.name))}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {hiddenCount > 0 && (
        <p className="hub-sidebar-note muted">
          <button className="link-button" onClick={() => setManaging(true)} title="Show or hide tags in Manage">
            {plural(hiddenCount, "hidden tag")}
          </button>
        </p>
      )}
      {managing && <TagManager counts={counts} onDismiss={() => setManaging(false)} />}
    </section>
  );
};

/** GitHub's label page as a side panel: every tag, with new, hide, edit and delete. */
export const TagManager: React.FC<{ counts: Map<string, number>; onDismiss: () => void }> = ({ counts, onDismiss }) => {
  const { tags, hidden } = useProjectTags();
  const [query, setQuery] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const shown = tags.filter((t) => `${t.name}\n${t.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  const hiddenShown = shown.filter((t) => hidden.has(tagKey(t.name))).length;
  return (
    <Panel
      onDismiss={onDismiss}
      size={ContentSize.Large}
      titleProps={{ text: "Tags" }}
      description="Colors and descriptions are shared with everyone in this project. Hiding a tag hides it from your sidebar only."
      showSeparator
    >
      <div className="tag-manager">
        <div className="tag-manager-toolbar">
          <div className="search-box">
            <Icon iconName="Search" />
            <input type="search" placeholder="Search all tags" aria-label="Search tags" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <span className="spacer" />
          <Button text="New tag" primary disabled={creating} onClick={() => setCreating(true)} />
        </div>
        {creating && (
          <div className="tag-manager-new">
            <TagForm previous={null} onDone={() => setCreating(false)} />
          </div>
        )}
        <div className="tag-manager-list" role="list">
          <div className="tag-manager-count">
            {plural(shown.length, "tag")}
            {hiddenShown > 0 && <span className="muted"> · {hiddenShown} hidden</span>}
          </div>
          {shown.length === 0 && <p className="muted tag-manager-empty">{query ? "No tags match." : "No tags yet. Create one, or add one to a pull request."}</p>}
          {shown.map((t) =>
            editing === t.name ? (
              <div key={t.name} role="listitem" className="tag-manager-row editing">
                <TagForm previous={t} onDone={() => setEditing(null)} />
              </div>
            ) : (
              <TagRow key={t.name} tag={t} count={counts.get(tagKey(t.name)) ?? 0} isHidden={hidden.has(tagKey(t.name))} onEdit={() => setEditing(t.name)} />
            ),
          )}
        </div>
      </div>
    </Panel>
  );
};

const TagRow: React.FC<{ tag: TagDef; count: number; isHidden: boolean; onEdit: () => void }> = ({ tag, count, isHidden, onEdit }) => {
  const { host, changed, setTagHidden } = useProjectTags();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const remove = async () => {
    if (!window.confirm(`Delete the tag "${tag.name}"? It's removed from every pull request and work item in this project. This can't be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await host!.tags().remove(tag.name);
      // So a new tag with this name later isn't hidden from the start.
      setTagHidden(tag.name, false);
      changed();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div role="listitem" className={cx("tag-manager-row", isHidden && "is-hidden")}>
      <span className="tag-manager-name">
        <TagPill name={tag.name} color={tag.color} title={isHidden ? "Hidden from your sidebar" : undefined} />
      </span>
      <span className="tag-manager-desc muted">{tag.description}</span>
      <span className="tag-manager-uses muted">{count ? plural(count, "open pull request") : ""}</span>
      <span className="tag-manager-actions">
        <button
          className="link-button"
          disabled={busy}
          aria-label={`${isHidden ? "Show" : "Hide"} the tag ${tag.name} in your sidebar`}
          onClick={() => setTagHidden(tag.name, !isHidden)}
        >
          {isHidden ? "Show" : "Hide"}
        </button>
        <button className="link-button" disabled={busy} onClick={onEdit}>
          Edit
        </button>
        <button className="link-button danger" disabled={busy} onClick={() => void remove()}>
          Delete
        </button>
      </span>
      {error && (
        <p className="tag-manager-error tone-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

/** Name, description and color, with a live preview; creates the tag when `previous` is null. */
const TagForm: React.FC<{ previous: TagDef | null; onDone: () => void }> = ({ previous, onDone }) => {
  const { host, tags, reload, changed, hidden, setTagHidden } = useProjectTags();
  const [name, setName] = React.useState(previous?.name ?? "");
  const [description, setDescription] = React.useState(previous?.description ?? "");
  const [colorText, setColorText] = React.useState(previous?.color ?? randomTagColor());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [picking, setPicking] = React.useState(false);
  const color = parseColor(colorText);
  const nameError = name ? tagNameError(name, tags, previous?.name ?? null) : null;
  const renaming = previous && name.trim() !== previous.name;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!color || tagNameError(name, tags, previous?.name ?? null)) return;
    setBusy(true);
    setError(null);
    try {
      await host!.tags().save(previous?.name ?? null, { name: name.trim(), description, color });
      if (renaming) {
        // Your hidden list follows the rename; other people's still name the old tag, so it shows again for them.
        if (hidden.has(tagKey(previous.name))) setTagHidden(name.trim(), true, previous.name);
        changed();
      } else reload();
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <form className="tag-form" onSubmit={submit}>
      <div className="tag-form-preview">
        <TagPill name={name.trim() || "Tag preview"} color={color ?? "#808080"} />
      </div>
      <div className="tag-form-fields">
        <label>
          <span>Tag name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tag name" maxLength={100} disabled={busy} autoFocus />
        </label>
        <label className="grow">
          <span>Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" maxLength={200} disabled={busy} />
        </label>
        <div
          className="tag-form-color"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPicking(false);
          }}
          onKeyDown={(e) => e.key === "Escape" && setPicking(false)}
        >
          <span>Color</span>
          <div className="tag-color-input">
            <button
              type="button"
              className="tag-color-refresh"
              style={{ background: color ?? "#808080", color: tagTextColor(color ?? "#808080") }}
              aria-label="Pick a random color"
              title="Pick a random color"
              disabled={busy}
              onClick={() => setColorText(randomTagColor())}
            >
              <Icon iconName="Refresh" />
            </button>
            <input
              value={colorText}
              onChange={(e) => setColorText(e.target.value)}
              onFocus={() => setPicking(true)}
              aria-label="Color (hex)"
              aria-invalid={!color}
              maxLength={7}
              disabled={busy}
              spellCheck={false}
            />
          </div>
          {picking && (
            // No mousedown focus change: Safari doesn't focus buttons, so the blur above would close this before the click.
            <div className="tag-swatches" role="listbox" aria-label="Choose from default colors" onMouseDown={(e) => (e.target as HTMLElement).tagName !== "INPUT" && e.preventDefault()}>
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="option"
                  aria-selected={c === color}
                  className={cx("tag-swatch", c === color && "selected")}
                  style={{ background: c }}
                  title={c}
                  onClick={() => setColorText(c)}
                />
              ))}
              <label className="tag-swatch custom" title="Any color">
                <input type="color" value={color ?? "#808080"} onChange={(e) => setColorText(e.target.value)} aria-label="Any color" />
                <Icon iconName="Color" />
              </label>
            </div>
          )}
        </div>
        <div className="tag-form-buttons">
          <Button text="Cancel" onClick={onDone} disabled={busy} />
          <Button text={previous ? "Save changes" : "Create tag"} primary type="submit" disabled={busy || !name.trim() || !!nameError || !color} />
        </div>
      </div>
      {(nameError || !color || renaming || error) && (
        <p className={cx("tag-form-note", (nameError || !color || error) && "tone-error")} role={error ? "alert" : undefined}>
          {error ?? nameError ?? (!color ? "Enter a color like #1d76db." : `Renaming changes "${previous!.name}" on every pull request and work item that has it.`)}
        </p>
      )}
    </form>
  );
};
