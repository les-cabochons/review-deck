import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALL_PROJECTS,
  type CatalogProject,
  CURRENT_PROJECT,
  CURRENT_REPO,
  isAll,
  parseSelection,
  projectState,
  repoChecked,
  resolveSelection,
  searchCatalog,
  selectionLabel,
  selectionScope,
  singleRepo,
  toggleProject,
  toggleRepo,
} from "../src/data/repoSelection";

const project = (id: string, name: string, repos: string[]): CatalogProject => ({ id, name, repos: repos.map((r) => ({ id: `${id}.${r}`, name: r, projectId: id })) });
const web = project("web", "Web", ["site", "api", "infra"]);
const data = project("data", "Data Platform", ["warehouse", "api-gateway"]);
const catalog = [data, web];

test("Given nothing picked, then every project is listed", () => {
  assert.equal(selectionScope(ALL_PROJECTS, ["web.site"]), "organization");
  assert.equal(selectionLabel(ALL_PROJECTS, catalog), "All projects");
});

test("Given a picked project, then its repositories are checked and picking it again clears them", () => {
  const picked = toggleProject({ ...ALL_PROJECTS, repos: ["web.api"] }, web);
  assert.deepEqual(picked, { favorites: false, projects: ["web"], repos: [] });
  assert.equal(projectState(picked, web), "checked");
  assert.ok(web.repos.every((r) => repoChecked(picked, r)));
  assert.equal(selectionLabel(picked, catalog), "Web");
  assert.deepEqual(toggleProject(picked, web), ALL_PROJECTS);
});

test("Given a picked project, when one repository is unchecked, then its siblings stay picked", () => {
  const s = toggleRepo(toggleProject(ALL_PROJECTS, web), web.repos[1], web);
  assert.deepEqual(s, { favorites: false, projects: [], repos: ["web.site", "web.infra"] });
  assert.equal(projectState(s, web), "mixed");
});

test("Given every repository of a project checked one by one, then the project is picked", () => {
  let s = ALL_PROJECTS;
  for (const r of web.repos) s = toggleRepo(s, r, web);
  assert.deepEqual(s, { favorites: false, projects: ["web"], repos: [] });
});

test("Given favorites and single repositories, then they are queried by repository id", () => {
  const s = { favorites: true, projects: ["data"], repos: ["web.site"] };
  assert.deepEqual(selectionScope(s, ["web.site", "web.api"]), { projects: ["data"], repos: ["web.site", "web.api"] });
  assert.deepEqual(selectionScope({ ...s, favorites: false }, ["web.api"]), { projects: ["data"], repos: ["web.site"] });
  assert.equal(selectionLabel(s, catalog), "Favorites, 1 project, 1 repository");
  assert.equal(selectionLabel({ ...ALL_PROJECTS, repos: ["web.site", "web.api"] }, catalog), "2 repositories");
});

test("Given a search, then projects and repositories match by name, prefix matches first", () => {
  const found = searchCatalog(catalog, "API");
  assert.deepEqual(found.projects, []);
  assert.deepEqual(
    found.repos.map((r) => [r.name, r.projectName]),
    [
      ["api", "Web"],
      ["api-gateway", "Data Platform"],
    ],
  );
  assert.deepEqual(searchCatalog(catalog, "data").projects.map((p) => p.name), ["Data Platform"]);
});

test("Given a saved selection, then malformed values are dropped", () => {
  assert.deepEqual(parseSelection('{"favorites":true,"projects":["a",1],"repos":"x"}'), { favorites: true, projects: ["a"], repos: [] });
  assert.equal(parseSelection("not json"), null);
  assert.equal(parseSelection(null), null);
});

test("Given exactly one repository listed, then a new pull request goes there", () => {
  const solo = project("solo", "Solo", ["only"]);
  assert.equal(singleRepo({ ...ALL_PROJECTS, repos: ["web.api"] }, [], catalog)?.id, "web.api");
  assert.equal(singleRepo({ ...ALL_PROJECTS, favorites: true }, ["data.warehouse"], catalog)?.id, "data.warehouse");
  assert.equal(singleRepo({ ...ALL_PROJECTS, projects: ["solo"] }, [], [...catalog, solo])?.id, "solo.only");
  assert.equal(singleRepo({ ...ALL_PROJECTS, repos: ["web.api", "web.site"] }, [], catalog), undefined);
  assert.equal(singleRepo({ ...ALL_PROJECTS, projects: ["web"] }, [], catalog), undefined);
  assert.equal(singleRepo(ALL_PROJECTS, [], catalog), undefined);
});

test("Given a current project or repository choice, then it stands for what Azure DevOps has selected each time", () => {
  const here = { projectId: "web", repoId: "web.site" };
  assert.deepEqual(resolveSelection(CURRENT_REPO, here), { ...ALL_PROJECTS, repos: ["web.site"] });
  assert.deepEqual(resolveSelection(CURRENT_PROJECT, here), { ...ALL_PROJECTS, projects: ["web"] });
  // No repository in the breadcrumb (e.g. TFVC): the current project.
  assert.deepEqual(resolveSelection(CURRENT_REPO, { projectId: "data", repoId: null }), { ...ALL_PROJECTS, projects: ["data"] });
  assert.equal(isAll(CURRENT_PROJECT), false);
  const picked = { ...ALL_PROJECTS, repos: ["web.api"] };
  assert.equal(resolveSelection(picked, here), picked);
  assert.deepEqual(parseSelection(JSON.stringify(CURRENT_REPO)), CURRENT_REPO);
  assert.deepEqual(parseSelection('{"current":"repo","projects":["x"]}'), CURRENT_REPO);
});
