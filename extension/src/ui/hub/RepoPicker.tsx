import { ExpandableButton } from "azure-devops-ui/Button";
import { Callout } from "azure-devops-ui/Callout";
import { Icon } from "azure-devops-ui/Icon";
import { Location } from "azure-devops-ui/Utilities/Position";
import * as React from "react";
import {
  type CatalogProject,
  type CatalogRepo,
  isAll,
  projectState,
  type RepoCatalog,
  repoChecked,
  type RepoSelection,
  ALL_PROJECTS,
  CURRENT_PROJECT,
  CURRENT_REPO,
  type CurrentContext,
  resolveSelection,
  searchCatalog,
  selectionLabel,
  toggleProject,
  toggleRepo,
} from "../../data/repoSelection";
import { cx, plural } from "../util";

/** Rows drawn per list; an organization can have thousands of repositories, so searching narrows the rest. */
const MAX_ROWS = 200;

interface PickerProps {
  /** Null while loading. */
  catalog: RepoCatalog | null;
  catalogError: string | null;
  selection: RepoSelection;
  /** What "current project" and "current repository" stand for; null until known. */
  context: CurrentContext | null;
  onChange: (selection: RepoSelection) => void;
  favorites: readonly string[];
  onToggleFavorite: (repoId: string) => void;
}

/**
 * The hub's project picker: check whole projects, or open one (the chevron) to check single repositories.
 * Search finds both. Starred repositories make up "Favorites".
 */
export const RepoPicker: React.FC<PickerProps> = (props) => {
  const { catalog, selection, context, favorites } = props;
  const shown = concrete(selection, context);
  const icon = isAll(shown) ? "Globe" : shown.favorites && !shown.projects.length && !shown.repos.length ? "FavoriteStarFill" : "Repo";
  return (
    <ExpandableButton
      className="repo-picker-button"
      text={
        selection.current && !context
          ? selection.current === "repo"
            ? "Current repository"
            : "Current project"
          : catalog || isAll(shown)
            ? selectionLabel(shown, catalog ?? [])
            : "Loading projects…"
      }
      iconProps={{ iconName: icon }}
      ariaLabel="Choose projects and repositories"
      tooltipProps={{ text: favorites.length ? `${plural(favorites.length, "favorite repository", "favorite repositories")}` : "Choose projects and repositories" }}
      renderCallout={(dropdown, id, anchorElement) => (
        <Callout
          id={id}
          anchorElement={anchorElement}
          anchorOrigin={{ horizontal: Location.start, vertical: Location.end }}
          calloutOrigin={{ horizontal: Location.start, vertical: Location.start }}
          anchorOffset={{ horizontal: 0, vertical: 4 }}
          lightDismiss
          escDismiss={false}
          onDismiss={() => dropdown.collapse()}
          contentClassName="repo-picker"
          contentShadow
          ariaLabel="Projects and repositories"
          role="dialog"
        >
          <PickerPanel {...props} onClose={() => dropdown.collapse()} />
        </Callout>
      )}
    />
  );
};

/** The projects and repositories a selection stands for: a "current" choice as its project or repository (none while unknown). */
const concrete = (s: RepoSelection, context: CurrentContext | null): RepoSelection =>
  !s.current ? s : context ? resolveSelection(s, context) : { ...ALL_PROJECTS, projects: [""] };

type Row =
  | { kind: "all" }
  | { kind: "current"; current: "project" | "repo" }
  | { kind: "favorites" }
  | { kind: "back"; project: CatalogProject }
  | { kind: "whole-project"; project: CatalogProject }
  | { kind: "project"; project: CatalogProject }
  | { kind: "repo"; repo: CatalogRepo; project: CatalogProject | undefined; projectName?: string };

interface Group {
  title?: string;
  rows: Row[];
  /** Rows beyond MAX_ROWS. */
  hidden: number;
  empty?: string;
}

const PickerPanel: React.FC<PickerProps & { onClose: () => void }> = ({ catalog, catalogError, selection: chosen, context, onChange, favorites, onToggleFavorite, onClose }) => {
  // Checking projects and repositories starts from what a "current" choice stands for.
  const selection = concrete(chosen, context);
  const [query, setQuery] = React.useState("");
  const [openProject, setOpenProject] = React.useState<string | null>(null);
  const [active, setActive] = React.useState(0);
  const input = React.useRef<HTMLInputElement>(null);
  const list = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => input.current?.focus(), []);

  const projects = catalog ?? [];
  const byId = React.useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const drilled = openProject ? byId.get(openProject) : undefined;
  const q = query.trim().toLowerCase();

  const capped = (title: string | undefined, rows: Row[], empty?: string): Group => ({ title, rows: rows.slice(0, MAX_ROWS), hidden: Math.max(0, rows.length - MAX_ROWS), empty });
  const groups: Group[] = [];
  if (drilled) {
    const repos = drilled.repos.filter((r) => !q || q.split(/\s+/).every((t) => r.name.toLowerCase().includes(t)));
    groups.push({ rows: [{ kind: "back", project: drilled }, ...(q ? [] : [{ kind: "whole-project", project: drilled } as Row])], hidden: 0 });
    groups.push(capped("Repositories", repos.map((repo) => ({ kind: "repo", repo, project: drilled })), q ? "No repositories match." : "This project has no repositories."));
  } else if (q) {
    const found = searchCatalog(projects, q);
    if (found.projects.length) groups.push(capped("Projects", found.projects.map((project) => ({ kind: "project", project }))));
    if (found.repos.length) groups.push(capped("Repositories", found.repos.map((r) => ({ kind: "repo", repo: r, project: byId.get(r.projectId), projectName: r.projectName }))));
    if (!groups.length) groups.push({ rows: [], hidden: 0, empty: catalog ? "No projects or repositories match." : undefined });
  } else {
    groups.push({
      title: "Selection",
      rows: [{ kind: "all" }, { kind: "current", current: "project" }, { kind: "current", current: "repo" }, { kind: "favorites" }],
      hidden: 0,
    });
    if (catalog) groups.push(capped("Projects", projects.map((project) => ({ kind: "project", project })), "No projects."));
  }
  const rows = groups.flatMap((g) => g.rows);
  const current = Math.min(active, Math.max(0, rows.length - 1));

  React.useEffect(() => setActive(0), [query, openProject]);
  React.useEffect(() => {
    list.current?.querySelector(".picker-row.active")?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const drill = (id: string | null) => {
    setOpenProject(id);
    setQuery("");
    input.current?.focus();
  };
  const activate = (row: Row) => {
    switch (row.kind) {
      case "all":
        return onChange(ALL_PROJECTS);
      case "current":
        return onChange(row.current === "repo" ? CURRENT_REPO : CURRENT_PROJECT);
      case "favorites":
        return favorites.length > 0 && onChange({ ...selection, favorites: !selection.favorites });
      case "back":
        return drill(null);
      case "whole-project":
      case "project":
        return onChange(toggleProject(selection, row.project));
      case "repo":
        return onChange(toggleRepo(selection, row.repo, row.project));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const row = rows[current];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(0, Math.min(rows.length - 1, current + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter" && row) {
      e.preventDefault();
      activate(row);
    } else if (e.key === "ArrowRight" && row?.kind === "project" && input.current?.selectionStart === query.length) {
      e.preventDefault();
      drill(row.project.id);
    } else if ((e.key === "ArrowLeft" || e.key === "Backspace") && drilled && !query) {
      e.preventDefault();
      drill(null);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (query) setQuery("");
      else if (drilled) drill(null);
      else onClose();
    }
  };

  let index = 0;
  return (
    <div className="repo-picker-panel" onKeyDown={onKeyDown}>
      <div className="repo-picker-search">
        <Icon iconName="Search" />
        <input
          ref={input}
          type="search"
          placeholder={drilled ? `Search repositories in ${drilled.name}…` : "Search projects and repositories…"}
          aria-label={drilled ? `Search repositories in ${drilled.name}` : "Search projects and repositories"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="repo-picker-list" role="menu" ref={list}>
        {groups.map((g, gi) => (
          <div key={gi} className="picker-group" role="group" aria-label={g.title}>
            {g.title && <div className="picker-group-title">{g.title}</div>}
            {g.rows.map((row) => {
              const i = index++;
              return (
                <PickerRow
                  key={rowKey(row)}
                  row={row}
                  active={i === current}
                  selection={selection}
                  chosen={chosen}
                  context={context}
                  catalog={projects}
                  favorites={favorites}
                  onHover={() => setActive(i)}
                  onActivate={() => activate(row)}
                  onOpen={(id) => drill(id)}
                  onToggleFavorite={onToggleFavorite}
                />
              );
            })}
            {g.rows.length === 0 && g.empty && <p className="picker-note muted">{g.empty}</p>}
            {g.hidden > 0 && <p className="picker-note muted">{plural(g.hidden, "more")}: search to narrow the list.</p>}
          </div>
        ))}
        {!catalog && !q && <p className="picker-note muted">{catalogError ? `Couldn't load projects: ${catalogError}` : "Loading projects…"}</p>}
      </div>
    </div>
  );
};

const rowKey = (row: Row) => `${row.kind}:${"repo" in row ? row.repo.id : "project" in row ? row.project.id : "current" in row ? row.current : ""}`;

const PickerRow: React.FC<{
  row: Row;
  active: boolean;
  selection: RepoSelection;
  /** The choice as made, which may be a "current" one. */
  chosen: RepoSelection;
  context: CurrentContext | null;
  catalog: RepoCatalog;
  favorites: readonly string[];
  onHover: () => void;
  onActivate: () => void;
  onOpen: (projectId: string) => void;
  onToggleFavorite: (repoId: string) => void;
}> = ({ row, active, selection, chosen, context, catalog, favorites, onHover, onActivate, onOpen, onToggleFavorite }) => {
  const common = { onMouseEnter: onHover, onClick: onActivate, className: cx("picker-row", active && "active") };
  switch (row.kind) {
    case "back":
      return (
        <div {...common} role="menuitem" className={cx(common.className, "picker-back")}>
          <Icon iconName="ChevronLeft" />
          <span className="picker-name">{row.project.name}</span>
        </div>
      );
    case "all":
      return (
        <div {...common} role="menuitemradio" aria-checked={isAll(selection)}>
          <Icon iconName="Globe" className="picker-lead" />
          <span className="picker-name">All projects</span>
          {isAll(chosen) && <Icon iconName="CheckMark" className="picker-tick" />}
        </div>
      );
    case "current": {
      const on = chosen.current === row.current;
      const project = context && catalog.find((p) => p.id === context.projectId);
      const name = row.current === "repo" ? project?.repos.find((r) => r.id === context?.repoId)?.name : project?.name;
      return (
        <div {...common} role="menuitemradio" aria-checked={on} title="Follows what's selected in Azure DevOps each time you open the hub">
          <Icon iconName={row.current === "repo" ? "Repo" : "ProjectCollection"} className="picker-lead" />
          <span className="picker-name">{row.current === "repo" ? "Current repository" : "Current project"}</span>
          {/* Without a repository in the breadcrumb (e.g. TFVC), "current repository" lists the current project. */}
          {name ? <span className="picker-meta muted">{name}</span> : row.current === "repo" && context && <span className="picker-meta muted">None selected: the project</span>}
          {on && <Icon iconName="CheckMark" className="picker-tick" />}
        </div>
      );
    }
    case "favorites": {
      const none = favorites.length === 0;
      return (
        <div {...common} role="menuitemcheckbox" aria-checked={selection.favorites} aria-disabled={none} className={cx(common.className, none && "disabled")}>
          <Check state={selection.favorites ? "checked" : "unchecked"} />
          <Icon iconName="FavoriteStarFill" className="picker-lead star-on" />
          <span className="picker-name">Favorites</span>
          <span className="picker-meta muted">{none ? "Star a repository to add it" : favorites.length}</span>
        </div>
      );
    }
    case "whole-project": {
      const state = projectState(selection, row.project);
      return (
        <div {...common} role="menuitemcheckbox" aria-checked={state === "mixed" ? "mixed" : state === "checked"}>
          <Check state={state} />
          <span className="picker-name">All repositories in {row.project.name}</span>
          <span className="picker-meta muted">{row.project.repos.length}</span>
        </div>
      );
    }
    case "project": {
      const state = projectState(selection, row.project);
      return (
        <div {...common} role="menuitemcheckbox" aria-checked={state === "mixed" ? "mixed" : state === "checked"}>
          <Check state={state} />
          <span className="picker-name">{row.project.name}</span>
          <span className="picker-meta muted" title={plural(row.project.repos.length, "repository", "repositories")}>
            {row.project.repos.length}
          </span>
          <button
            className="picker-icon-button"
            aria-label={`Show repositories in ${row.project.name}`}
            title="Show repositories"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(row.project.id);
            }}
          >
            <Icon iconName="ChevronRight" />
          </button>
        </div>
      );
    }
    case "repo": {
      const starred = favorites.includes(row.repo.id);
      return (
        <div {...common} role="menuitemcheckbox" aria-checked={repoChecked(selection, row.repo)}>
          <Check state={repoChecked(selection, row.repo) ? "checked" : "unchecked"} />
          <Icon iconName="Repo" className="picker-lead" />
          <span className="picker-name">{row.repo.name}</span>
          {row.projectName && <span className="picker-meta muted picker-project">{row.projectName}</span>}
          <button
            className={cx("picker-icon-button", "picker-star", starred && "starred")}
            aria-pressed={starred}
            aria-label={`${starred ? "Remove" : "Add"} ${row.repo.name} ${starred ? "from" : "to"} favorites`}
            title={starred ? "Remove from favorites" : "Add to favorites"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(row.repo.id);
            }}
          >
            <Icon iconName={starred ? "FavoriteStarFill" : "FavoriteStar"} />
          </button>
        </div>
      );
    }
  }
};

const Check: React.FC<{ state: "checked" | "mixed" | "unchecked" }> = ({ state }) => (
  <span className={cx("picker-check", state)} aria-hidden="true">
    {state === "checked" && <Icon iconName="CheckMark" />}
    {state === "mixed" && <span className="picker-mixed" />}
  </span>
);
