// What the hub lists: whole projects, single repositories, your favorite repositories, or everything.

export interface CatalogRepo {
  id: string;
  name: string;
  projectId: string;
}

export interface CatalogProject {
  id: string;
  name: string;
  repos: CatalogRepo[];
}

/** Every project you can see with its repositories, sorted by name. */
export type RepoCatalog = CatalogProject[];

/**
 * Picked in the hub's project picker. Nothing picked lists every project. `favorites` stands for your
 * starred repositories as they are when the list loads, so starring one later adds it.
 */
export interface RepoSelection {
  favorites: boolean;
  projects: string[];
  repos: string[];
}

export const ALL_PROJECTS: RepoSelection = { favorites: false, projects: [], repos: [] };

/** Where the hub looks for pull requests: every project you can see, or some projects and repositories (ids). */
export type ListScope = "organization" | { projects: string[]; repos: string[] };

export function isAll(s: RepoSelection): boolean {
  return !s.favorites && s.projects.length === 0 && s.repos.length === 0;
}

/** Selecting a project subsumes its repositories; unselecting it leaves none of them picked. */
export function toggleProject(s: RepoSelection, project: CatalogProject): RepoSelection {
  const own = new Set(project.repos.map((r) => r.id));
  const repos = s.repos.filter((id) => !own.has(id));
  return s.projects.includes(project.id) ? { ...s, projects: s.projects.filter((p) => p !== project.id), repos } : { ...s, projects: [...s.projects, project.id], repos };
}

/** Unchecking one repository of a picked project keeps its siblings picked; picking every repository picks the project. */
export function toggleRepo(s: RepoSelection, repo: CatalogRepo, project: CatalogProject | undefined): RepoSelection {
  if (project && s.projects.includes(repo.projectId)) {
    const siblings = project.repos.filter((r) => r.id !== repo.id).map((r) => r.id);
    return { ...s, projects: s.projects.filter((p) => p !== repo.projectId), repos: [...s.repos, ...siblings] };
  }
  if (s.repos.includes(repo.id)) return { ...s, repos: s.repos.filter((r) => r !== repo.id) };
  const own = project ? new Set(project.repos.map((r) => r.id)) : null;
  if (project && own!.size > 1 && project.repos.every((r) => r.id === repo.id || s.repos.includes(r.id))) {
    return { ...s, projects: [...s.projects, project.id], repos: s.repos.filter((id) => !own!.has(id)) };
  }
  return { ...s, repos: [...s.repos, repo.id] };
}

/** "checked", "mixed" (some of its repositories) or "unchecked". */
export function projectState(s: RepoSelection, project: CatalogProject): "checked" | "mixed" | "unchecked" {
  if (s.projects.includes(project.id)) return "checked";
  return project.repos.some((r) => s.repos.includes(r.id)) ? "mixed" : "unchecked";
}

export function repoChecked(s: RepoSelection, repo: CatalogRepo): boolean {
  return s.projects.includes(repo.projectId) || s.repos.includes(repo.id);
}

/** The queries behind a selection. A repository inside a picked project may be asked twice; lists drop duplicate PRs. */
export function selectionScope(s: RepoSelection, favorites: readonly string[]): ListScope {
  if (isAll(s)) return "organization";
  return { projects: s.projects, repos: [...new Set([...s.repos, ...(s.favorites ? favorites : [])])] };
}

/** The picker button's text. */
export function selectionLabel(s: RepoSelection, catalog: RepoCatalog): string {
  if (isAll(s)) return "All projects";
  const parts: string[] = [];
  if (s.favorites) parts.push("Favorites");
  const project = (id: string) => catalog.find((p) => p.id === id);
  const repo = (id: string) => catalog.flatMap((p) => p.repos).find((r) => r.id === id);
  if (s.projects.length === 1 && s.repos.length === 0) parts.push(project(s.projects[0])?.name ?? "1 project");
  else if (s.projects.length) parts.push(plural(s.projects.length, "project"));
  if (s.repos.length === 1 && s.projects.length === 0) parts.push(repo(s.repos[0])?.name ?? "1 repository");
  else if (s.repos.length) parts.push(plural(s.repos.length, "repository", "repositories"));
  return parts.join(", ");
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A saved selection, or null when missing or malformed. */
export function parseSelection(json: string | null): RepoSelection | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<RepoSelection>;
    const ids = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : []);
    return { favorites: v.favorites === true, projects: ids(v.projects), repos: ids(v.repos) };
  } catch {
    return null;
  }
}

export interface CatalogMatches {
  projects: CatalogProject[];
  repos: (CatalogRepo & { projectName: string })[];
}

/** Projects and repositories whose name contains every word of the query, names starting with it first. */
export function searchCatalog(catalog: RepoCatalog, query: string): CatalogMatches {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (name: string) => terms.every((t) => name.toLowerCase().includes(t));
  const rank = <T extends { name: string }>(items: T[]) => {
    const first = terms[0] ?? "";
    return items.sort((a, b) => Number(!a.name.toLowerCase().startsWith(first)) - Number(!b.name.toLowerCase().startsWith(first)) || a.name.localeCompare(b.name));
  };
  return {
    projects: rank(catalog.filter((p) => hit(p.name))),
    repos: rank(catalog.flatMap((p) => p.repos.filter((r) => hit(r.name)).map((r) => ({ ...r, projectName: p.name })))),
  };
}
