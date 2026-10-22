// Run through playwright-cli run-code --filename=extension/tests/nav-groups.browser.js.
// The page must be the local /dev/?pr=17901&repo=t3code#files mock.
async (page) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const f = page.frameLocator("#frame");
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const view = f.locator(".files-toolbar .mode-toggle").first().locator("button").first();
  if ((await view.textContent()).trim() !== "Guided") await view.click();
  const groups = f.locator(".nav-group");
  const first = groups.first();
  const toggle = first.locator(".nav-group-toggle");
  await toggle.waitFor();
  if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
  await first.locator("file-tree-container").waitFor();
  const treeId = await toggle.getAttribute("aria-controls");
  const body = f.locator(`[id="${treeId}"]`);
  const height = (await first.boundingBox()).height;
  const secondToggle = groups.nth(1).locator(".nav-group-toggle");
  const secondExpanded = await secondToggle.getAttribute("aria-expanded");
  const diffExpanded = await f.locator(".group-header").first().getAttribute("aria-expanded");

  // Given an expanded group, a mouse click hides only its sidebar files.
  await toggle.click();
  assert(await toggle.getAttribute("aria-expanded") === "false", "Group did not collapse");
  assert(!await body.isVisible(), "Collapsed tree remains visible");
  assert((await first.boundingBox()).height < height, "Collapse did not reclaim sidebar space");
  assert(await secondToggle.getAttribute("aria-expanded") === secondExpanded, "Another group changed");
  assert(await f.locator(".group-header").first().getAttribute("aria-expanded") === diffExpanded, "Sidebar collapse changed the diff group");

  // Given a focused disclosure, Enter and Space both toggle it.
  await toggle.press("Enter");
  assert(await toggle.getAttribute("aria-expanded") === "true", "Enter did not expand the group");
  await first.locator("file-tree-container").waitFor();
  await toggle.press("Space");
  assert(await toggle.getAttribute("aria-expanded") === "false", "Space did not collapse the group");

  // Given a collapsed group, navigation changes retain that choice.
  await view.click();
  await f.locator(".file-card").first().waitFor();
  await view.click();
  assert(await toggle.getAttribute("aria-expanded") === "false", "View switch reset collapse");
  await f.getByRole("button", { name: "Hide file tree", exact: true }).click();
  await f.getByRole("button", { name: "Show file tree", exact: true }).click();
  assert(await toggle.getAttribute("aria-expanded") === "false", "Sidebar visibility reset collapse");
  const search = f.getByRole("searchbox", { name: "Search files" });
  await search.fill("does-not-exist");
  await f.locator(".nav-empty").waitFor();
  await search.fill("");
  assert(await toggle.getAttribute("aria-expanded") === "false", "Search reset collapse");
  await f.locator(".file-filter-button").click();
  await f.getByRole("menuitemcheckbox", { name: /Test files/ }).click();
  await search.press("Escape");
  await f.locator(".nav-hidden-note .link-button").click();
  assert(await toggle.getAttribute("aria-expanded") === "false", "Filtering reset collapse");

  // Given a collapsed sidebar group, its title still jumps to the corresponding diff.
  const sectionId = treeId.replace("nav-group-tree-", "group-");
  await first.locator(".nav-group-title").click();
  await page.waitForTimeout(400);
  const section = f.locator(`[id="${sectionId}"]`);
  const sectionTop = await section.evaluate(element => element.getBoundingClientRect().top);
  assert(sectionTop >= 0 && sectionTop < 100, "Group title did not jump to its diff");
  assert(await toggle.getAttribute("aria-expanded") === "false", "Group jump expanded the sidebar");

  // Given a collapsed diff group, selecting a file still opens its diff and scrolls there.
  await toggle.click();
  await first.locator("file-tree-container").waitFor();
  const diffToggle = section.locator(".group-header");
  if (await diffToggle.getAttribute("aria-expanded") === "true") await diffToggle.click();
  await first.locator('file-tree-container [data-item-type="file"]').first().click();
  assert(await diffToggle.getAttribute("aria-expanded") === "true", "File selection did not open its diff group");
  assert(errors.length === 0, errors.join("\n"));
  return { mouseCollapse: true, keyboardCollapse: true, independentGroups: true,
    retainedAcrossViewsSearchFiltersAndSidebar: true, groupJump: true, fileSelection: true, errors };
}
