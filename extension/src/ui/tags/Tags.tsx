import { Button } from "azure-devops-ui/Button";
import { ContentSize } from "azure-devops-ui/Callout";
import { Icon } from "azure-devops-ui/Icon";
import { Panel } from "azure-devops-ui/Panel";
import * as React from "react";
import type { AppHost } from "../../app/host";
import { defaultTagColor, parseColor, randomTagColor, TAG_COLORS, type TagDef, tagKey, tagNameError, tagPillStyle, tagTextColor } from "../../data/tags";
import { usePierreTheme } from "../pierre/theme";
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
}

const TagContext = React.createContext<ProjectTags>({ tags: [], byKey: new Map(), reload: () => {}, revision: 0, changed: () => {}, dark: false, host: null });
export const useProjectTags = () => React.useContext(TagContext);

/** Loads the project's tags once for both pages; editors call reload() after a change. */
export const ProjectTagsProvider: React.FC<{ host: AppHost; children: React.ReactNode }> = ({ host, children }) => {
  const [tags, setTags] = React.useState<TagDef[]>([]);
  const reload = React.useCallback(() => {
    host
      .tags()
      .list()
      .then(setTags, (e) => console.warn("[semantic-pr] tags unavailable:", e));
  }, [host]);
  React.useEffect(reload, [reload]);
  const [revision, setRevision] = React.useState(0);
  const changed = React.useCallback(() => {
    reload();
    setRevision((r) => r + 1);
  }, [reload]);
  const dark = usePierreTheme() === "dark";
  const value = React.useMemo(
    () => ({ tags, byKey: new Map(tags.map((t) => [tagKey(t.name), t])), reload, revision, changed, dark, host }),
    [tags, reload, revision, changed, dark, host],
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

/** Hub sidebar: every tag with its open pull request count; a click filters the list. */
export const SidebarTags: React.FC<{ counts: Map<string, number>; active: string | null; onSelect: (name: string | null) => void }> = ({ counts, active, onSelect }) => {
  const { tags } = useProjectTags();
  const [managing, setManaging] = React.useState(false);
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
          {tags.map((t) => {
            const isActive = active !== null && tagKey(active) === tagKey(t.name);
            return (
              <li key={t.name}>
                <button className={cx("hub-tag", isActive && "active")} aria-pressed={isActive} onClick={() => onSelect(isActive ? null : t.name)} title={t.description || undefined}>
                  <span className="tag-dot" style={{ background: t.color }} />
                  <span className="text">{t.name}</span>
                  {!!counts.get(tagKey(t.name)) && <span className="count">{counts.get(tagKey(t.name))}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {managing && <TagManager counts={counts} onDismiss={() => setManaging(false)} />}
    </section>
  );
};

/** GitHub's label page as a side panel: every tag, with new, edit and delete. */
export const TagManager: React.FC<{ counts: Map<string, number>; onDismiss: () => void }> = ({ counts, onDismiss }) => {
  const { tags } = useProjectTags();
  const [query, setQuery] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const shown = tags.filter((t) => `${t.name}\n${t.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <Panel onDismiss={onDismiss} size={ContentSize.Large} titleProps={{ text: "Tags" }} description="Colors and descriptions are shared with everyone in this project." showSeparator>
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
          <div className="tag-manager-count">{plural(shown.length, "tag")}</div>
          {shown.length === 0 && <p className="muted tag-manager-empty">{query ? "No tags match." : "No tags yet. Create one, or add one to a pull request."}</p>}
          {shown.map((t) =>
            editing === t.name ? (
              <div key={t.name} role="listitem" className="tag-manager-row editing">
                <TagForm previous={t} onDone={() => setEditing(null)} />
              </div>
            ) : (
              <TagRow key={t.name} tag={t} count={counts.get(tagKey(t.name)) ?? 0} onEdit={() => setEditing(t.name)} />
            ),
          )}
        </div>
      </div>
    </Panel>
  );
};

const TagRow: React.FC<{ tag: TagDef; count: number; onEdit: () => void }> = ({ tag, count, onEdit }) => {
  const { host, changed } = useProjectTags();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const remove = async () => {
    if (!window.confirm(`Delete the tag "${tag.name}"? It's removed from every pull request and work item in this project. This can't be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await host!.tags().remove(tag.name);
      changed();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div role="listitem" className="tag-manager-row">
      <span className="tag-manager-name">
        <TagPill name={tag.name} color={tag.color} />
      </span>
      <span className="tag-manager-desc muted">{tag.description}</span>
      <span className="tag-manager-uses muted">{count ? plural(count, "open pull request") : ""}</span>
      <span className="tag-manager-actions">
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
  const { host, tags, reload, changed } = useProjectTags();
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
      if (renaming) changed();
      else reload();
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
