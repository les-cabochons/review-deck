// Run through playwright-cli run-code --filename=extension/tests/viewed-fold.browser.js.
// Uses the local mock and this browser profile's viewed state, which it clears for one concern.
async page => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const f = page.frameLocator('#frame');
  const settle = async () => {
    await f.locator('.file-header').first().waitFor();
    await f.locator('.analyzing-note').waitFor({ state: 'detached', timeout: 60000 });
    await page.waitForTimeout(1500);
  };
  await page.reload();
  await settle();
  const view = f.locator('.mode-toggle').first();
  if (!(await view.innerText()).includes('Guided')) await view.locator('button').first().click();
  // Start from a clean slate: nothing viewed.
  // Mixed concerns need two clicks: the first marks every file, the second clears them.
  for (const box of await f.locator('.group-header-row .viewed-control input').all())
    for (let i = 0; i < 2 && (await box.evaluate((input) => input.checked || input.indeterminate)); i++) await box.click();
  // A concern with several files, so ticking one file doesn't complete the concern.
  const sectionId = await f.locator('.group-section[id^="group-"]').evaluateAll(sections =>
    sections.find(s => new Set([...s.querySelectorAll('.file-path')].map(p => p.title)).size > 1)?.id);
  const section = f.locator(`.group-section[id="${sectionId}"]`);
  const header = section.locator('.group-header');
  const box = section.locator('.group-header-row .viewed-control input');
  const r = {};
  r.openAtStart = await header.getAttribute('aria-expanded') === 'true';
  // Ticking a file's Viewed folds the file.
  const card = section.locator('article').first();
  const cardId = await card.getAttribute('id');
  const fileCard = f.locator(`article[id="${cardId}"]`);
  await fileCard.locator('.viewed-control input').click();
  await fileCard.locator('.file-collapse[aria-expanded="false"]').waitFor();
  r.fileFoldsOnViewed = true;
  await fileCard.locator('.viewed-control input').click();
  await fileCard.locator('.file-collapse[aria-expanded="true"]').waitFor();
  r.fileUnfoldsOnUnviewed = true;
  // Ticking every file one by one never folds the concern being read.
  for (const input of await section.locator('article .viewed-control input').all()) if (!(await input.isChecked())) await input.click();
  await page.waitForTimeout(300);
  r.groupStaysOpenWhenFilesTicked = await header.getAttribute('aria-expanded') === 'true';
  // Clear the concern (only mounted cards were ticked, so it may be mixed), then tick it once.
  for (let i = 0; i < 2 && (await box.evaluate((input) => input.checked || input.indeterminate)); i++) await box.click();
  await page.waitForTimeout(300);
  // Ticking the concern's Viewed folds the concern; unticking unfolds it.
  await box.click();
  await section.locator('.group-header[aria-expanded="false"]').waitFor();
  r.groupFoldsOnViewed = await section.locator('article').count() === 0;
  await section.screenshot({ path: 'output/playwright/group-folded.png' });
  // A fully viewed concern is still folded after a reload.
  await page.reload();
  await settle();
  r.groupFoldedAfterReload = await f.locator(`.group-section[id="${sectionId}"]`).locator('.group-header').getAttribute('aria-expanded') === 'false';
  await f.locator(`.group-section[id="${sectionId}"]`).locator('.group-header-row .viewed-control input').click();
  await f.locator(`.group-section[id="${sectionId}"]`).locator('.group-header[aria-expanded="true"]').waitFor();
  r.groupUnfoldsOnUnviewed = await f.locator(`.group-section[id="${sectionId}"]`).locator('article').count() > 0;
  if (errors.length) throw new Error(errors.join('\n'));
  return { sectionId, ...r, errors };
}
