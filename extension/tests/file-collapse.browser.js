// Run through playwright-cli run-code --filename=extension/tests/file-collapse.browser.js.
// Uses the local mock: deleted files start folded, and file folds work in both views.
async page => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173/dev/?pr=17901&repo=t3code#files');
  const f = page.frameLocator('#frame');
  await f.locator('.file-header').first().waitFor();
  await f.locator('.meta-stats .grouping-status').waitFor({ state: 'detached', timeout: 60000 });
  await page.waitForTimeout(1500);
  const result = {};
  // The Files toolbar's gear holds the view settings (Guided or Files A–Z, Inline or Side-by-side).
  const setting = async name => {
    await f.getByRole('button', { name: 'File view settings', exact: true }).click();
    const item = f.getByRole('menuitem', { name, exact: true });
    // Picking the current one changes nothing, so the menu just closes.
    if (await item.evaluate(el => el.classList.contains('menu-item-selected'))) await page.keyboard.press('Escape');
    else await item.click();
  };
  for (const view of ['Guided', 'Files A–Z']) {
    await setting(view);
    await page.waitForTimeout(500);
    // Deleted files start folded: header only.
    const deleted = f.locator('article', { has: f.locator('.file-status-deleted') }).first();
    // Cards mount near the viewport, so scroll until the deleted file renders.
    await f.locator('body').evaluate(() => window.scrollTo(0, 0));
    for (let i = 0; i < 200 && !(await deleted.count()); i++) await f.locator('body').evaluate(() => window.scrollBy(0, 600));
    await deleted.scrollIntoViewIfNeeded();
    await deleted.screenshot({ path: `output/playwright/deleted-folded-${view === 'Guided' ? 'grouped' : 'alpha'}.png` });
    const deletedFolded = await deleted.locator('.file-collapse').getAttribute('aria-expanded') === 'false'
      && await deleted.locator('.pierre-hunk-header, .diff-note').count() === 0;
    // Any other file folds and unfolds.
    await f.locator('body').evaluate(() => window.scrollTo(0, 0));
    const id = await f.locator('article', { has: f.locator('.pierre-hunk-header'), hasNot: f.locator('.file-status-deleted') }).first().getAttribute('id');
    const card = f.locator(`article[id="${id}"]`);
    await card.scrollIntoViewIfNeeded();
    await card.locator('.pierre-hunk-header').first().waitFor();
    const before = await card.locator('.pierre-hunk-header').count();
    await card.locator('.file-collapse').click();
    await card.locator('.file-collapse[aria-expanded="false"]').waitFor();
    const folded = await card.locator('.pierre-hunk-header').count();
    await card.screenshot({ path: `output/playwright/file-collapsed-${view === 'Guided' ? 'grouped' : 'alpha'}.png` });
    await card.locator('.file-collapse').click();
    await card.locator('.pierre-hunk-header').first().waitFor();
    const unfolded = await card.locator('.pierre-hunk-header').count();
    result[view] = { deletedFolded, before, folded, unfolded };
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return { ...result, errors };
}
