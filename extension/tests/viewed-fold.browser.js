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
  // Mixed concerns need two clicks. The first marks every chunk and the second clears them.
  for (const box of await f.locator('.group-header-row .viewed-control input').all())
    for (let i = 0; i < 2 && (await box.evaluate((input) => input.checked || input.indeterminate)); i++) await box.click();
  // Those clicks scrolled the page, and cards only mount near the viewport, so go back to the top concerns.
  await f.locator('body').evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  const r = {};
  // A file's chunks can sit on several cards. Ticking one card folds that card only, not the file's other chunks.
  const repeated = await f.locator('.group-section[id^="group-"]').evaluateAll(sections => {
    for (const s of sections) {
      const cards = [...s.querySelectorAll('article')].filter(a => a.querySelector('.viewed-control input'));
      const paths = cards.map(a => a.querySelector('.file-path').title);
      const path = paths.find((p, i) => paths.indexOf(p) !== i);
      if (path) return cards.filter((_, i) => paths[i] === path).map(a => a.id);
    }
  });
  if (!repeated) throw new Error('No mounted file with chunks on several cards');
  const [ticked, ...siblings] = repeated.map(id => f.locator(`article[id="${id}"]`));
  // Each card's controls name its lines, so screen readers can tell the file's cards apart.
  const names = await Promise.all([ticked, ...siblings].map(card => card.locator('.viewed-control input').getAttribute('aria-label')));
  r.cardNamesDiffer = new Set(names).size === names.length;
  // A comment on the whole file shows on one card, so give the file one (the mock keeps it until the reload below).
  const path = await ticked.locator('.file-path').getAttribute('title');
  await ticked.getByRole('button', { name: `Comment on ${path}`, exact: true }).click();
  const composer = ticked.locator('.file-comments .comment-composer');
  await composer.locator('[contenteditable], textarea').first().fill('Per-chunk fold check');
  await composer.getByRole('button', { name: 'Add single comment' }).click();
  const fileThread = card => card.locator('.file-comments .thread').filter({ hasText: 'Per-chunk fold check' });
  await fileThread(ticked).waitFor();
  await ticked.locator('.viewed-control input').click();
  await ticked.locator('.file-collapse[aria-expanded="false"]').waitFor();
  r.siblingChunksStayOpen = true;
  for (const sibling of siblings)
    r.siblingChunksStayOpen &&= await sibling.locator('.file-collapse').getAttribute('aria-expanded') === 'true'
      && !(await sibling.locator('.viewed-control input').isChecked());
  // The comment moves to the file's next open card instead of disappearing with the folded one.
  await fileThread(siblings[0]).waitFor({ timeout: 3000 }).catch(() => null);
  r.fileCommentMovesToOpenCard = await fileThread(siblings[0]).count() === 1;
  await ticked.locator('.viewed-control input').click();
  await ticked.locator('.file-collapse[aria-expanded="true"]').waitFor();
  // A concern with several files, so ticking one file doesn't complete the concern.
  const sectionId = await f.locator('.group-section[id^="group-"]').evaluateAll(sections =>
    sections.find(s => new Set([...s.querySelectorAll('.file-path')].map(p => p.title)).size > 1)?.id);
  const section = f.locator(`.group-section[id="${sectionId}"]`);
  const header = section.locator('.group-header');
  const box = section.locator('.group-header-row .viewed-control input');
  r.openAtStart = await header.getAttribute('aria-expanded') === 'true';
  // Ticking a card's Viewed folds the card.
  const card = section.locator('article').first();
  const cardId = await card.getAttribute('id');
  const fileCard = f.locator(`article[id="${cardId}"]`);
  await fileCard.scrollIntoViewIfNeeded();
  await fileCard.locator('.viewed-control input').click();
  await fileCard.locator('.file-collapse[aria-expanded="false"]').waitFor();
  r.cardFoldsOnViewed = true;
  await fileCard.locator('.viewed-control input').click();
  await fileCard.locator('.file-collapse[aria-expanded="true"]').waitFor();
  r.cardUnfoldsOnUnviewed = true;
  // Ticking every card one by one never folds the concern being read.
  for (const input of await section.locator('article .viewed-control input').all()) if (!(await input.isChecked())) await input.click();
  await page.waitForTimeout(300);
  r.groupStaysOpenWhenCardsTicked = await header.getAttribute('aria-expanded') === 'true';
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
