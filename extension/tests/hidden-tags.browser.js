// Run through playwright-cli run-code --filename=extension/tests/hidden-tags.browser.js, with npm run ext:dev running.
// Opens the local mock's hub, hides tags in the Tags panel ("Manage"), and checks that they leave the sidebar
// but stay on pull request rows, that the choice survives a reload, and that a hidden tag filtering the list
// stays listed until the filter is cleared.
async page => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  await page.setViewportSize({ width: 1280, height: 900 });
  const url = 'http://127.0.0.1:5173/dist/review.html?local';
  // From a blank page, and without hidden tags left over from an earlier run.
  await page.goto('about:blank');
  await page.goto(url);
  await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('semantic-review.tags.hidden.')).forEach(k => localStorage.removeItem(k)));
  await page.reload();

  const sidebar = page.locator('.hub-tags');
  const sidebarNames = async () => (await sidebar.locator('.hub-tag .text').allTextContents()).map(t => t.trim());
  await sidebar.locator('.hub-tag').first().waitFor();
  // Two tags on open pull requests, so the rows below the sidebar carry them.
  const used = sidebar.locator('.hub-tag').filter({ has: page.locator('.count') });
  assert(await used.count() >= 2, 'The mock needs two tags on open pull requests');
  const first = (await used.nth(0).locator('.text').textContent()).trim();
  const second = (await used.nth(1).locator('.text').textContent()).trim();
  const all = await sidebarNames();

  const panel = page.locator('.tag-manager');
  const openManager = async () => {
    await sidebar.getByRole('button', { name: 'Manage' }).click();
    await panel.waitFor();
  };
  const closeManager = async () => {
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached' });
  };
  const toggle = (verb, name) => panel.getByRole('button', { name: `${verb} the tag ${name} in your sidebar`, exact: true });

  // Given the Tags panel, Hide fades the row and leaves it listed there.
  await openManager();
  await toggle('Hide', first).click();
  await toggle('Show', first).waitFor();
  assert(await panel.locator('.tag-manager-row.is-hidden').count() === 1, 'Hidden row is not marked');
  assert((await panel.locator('.tag-manager-count').textContent()).includes('1 hidden'), 'Panel count does not mention the hidden tag');
  await closeManager();

  // Then the sidebar drops it and says one tag is hidden, while pull request rows keep it.
  assert(!(await sidebarNames()).includes(first), `Sidebar still lists ${first}`);
  assert((await sidebarNames()).length === all.length - 1, 'Hiding one tag removed more than one');
  await sidebar.getByRole('button', { name: '1 hidden tag' }).waitFor();
  assert(await page.locator('.hub-main .tag-pill', { hasText: first }).count() > 0, `Rows lost the hidden tag ${first}`);

  // Given a reload, the tag stays hidden.
  await page.reload();
  await sidebar.locator('.hub-tag').first().waitFor();
  assert(!(await sidebarNames()).includes(first), `${first} came back after a reload`);

  // Given a tag filtering the list, hiding it keeps it listed until the filter is cleared.
  const secondButton = () => sidebar.locator('.hub-tag', { hasText: second });
  await secondButton().click();
  assert(await secondButton().getAttribute('aria-pressed') === 'true', 'Tag filter did not apply');
  await sidebar.getByRole('button', { name: '1 hidden tag' }).click();
  await panel.waitFor();
  await toggle('Hide', second).click();
  await closeManager();
  assert((await sidebarNames()).includes(second), 'The active filter tag left the sidebar');
  await sidebar.getByRole('button', { name: '2 hidden tags' }).waitFor();
  await secondButton().click();
  assert(!(await sidebarNames()).includes(second), `${second} stayed listed after its filter was cleared`);

  // Given Show on both, the sidebar lists every tag again.
  await openManager();
  await toggle('Show', first).click();
  await toggle('Show', second).click();
  await closeManager();
  assert(JSON.stringify(await sidebarNames()) === JSON.stringify(all), 'Sidebar did not list every tag again');
  assert(await sidebar.getByRole('button', { name: /hidden tag/ }).count() === 0, 'Hidden note stayed with nothing hidden');

  assert(errors.length === 0, `Page errors: ${errors.join('; ')}`);
  return { hidden: [first, second], tags: all.length };
}
