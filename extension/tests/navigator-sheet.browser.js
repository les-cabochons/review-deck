// Run through playwright-cli run-code --filename=extension/tests/navigator-sheet.browser.js.
// Uses the local mock at a phone's width (412 px): the sidebar is hidden, a button at the bottom opens the navigator
// as a bottom sheet, and picking a concern or a file closes it and scrolls there. At 1280 px the button is hidden.
async page => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  await page.setViewportSize({ width: 412, height: 915 });
  // From a blank page: a goto to the URL already open only changes the hash and keeps the page's state.
  await page.goto('about:blank');
  await page.goto('http://127.0.0.1:5173/dist/review.html?local&pr=17901&repo=t3code#files');
  await page.locator('.file-header').first().waitFor();
  await page.locator('.analyzing-note').waitFor({ state: 'detached', timeout: 60000 });
  await page.waitForTimeout(1500);
  const view = page.locator('.mode-toggle').first();
  if (!(await view.innerText()).includes('Guided')) await view.locator('button').first().click();
  await page.waitForTimeout(500);

  const button = page.locator('.navigator-sheet-button');
  const sheet = page.getByRole('dialog', { name: 'Concerns' });
  // In the top half of the screen and not under the toolbar (sticky on wide screens only).
  const inView = selector => page.evaluate(selector => {
    const toolbar = document.querySelector('.files-toolbar').getBoundingClientRect().bottom;
    const top = document.querySelector(selector).getBoundingClientRect().top;
    return top >= toolbar - 1 && top < innerHeight / 2;
  }, selector);

  assert(await button.isVisible(), 'No navigator button at phone width');
  assert(!(await page.locator('.files-layout .nav-hide').isVisible()), 'The sidebar\'s Hide file tree row shows at phone width');
  assert(!(await page.locator('.files-layout > .navigator').isVisible()), 'The sidebar shows at phone width');

  // A concern: the sheet lists every concern, closes on pick, and the concern is on screen.
  await button.click();
  await sheet.waitFor();
  const listed = await sheet.locator('.nav-group-title').count();
  const sections = await page.locator('.group-section[id^="group-"]').count();
  assert(listed === sections, `The sheet lists ${listed} concerns, the page has ${sections}`);
  assert(await sheet.locator('.nav-hide').count() === 0, 'The sheet has the sidebar\'s Hide file tree row');
  const overflow = await sheet.locator('.navigator').evaluate(nav => nav.scrollWidth - nav.clientWidth);
  assert(overflow <= 0, `The sheet scrolls sideways by ${overflow} px`);
  const target = await page.locator('.group-section[id^="group-"]').nth(2).getAttribute('id');
  await sheet.locator('.nav-group-title').nth(2).click();
  await sheet.waitFor({ state: 'detached' });
  await page.waitForTimeout(500);
  assert(await inView(`[id="${target}"]`), `Picking a concern did not bring ${target} on screen`);

  // A file in the first concern's tree (back up the page): same, and the file's card is on screen.
  await button.click();
  await sheet.waitFor();
  const file = sheet.locator('file-tree-container').first().locator('[data-item-type="file"]').first();
  await file.waitFor();
  const name = await file.getAttribute('aria-label');
  const group = await page.locator('.group-section[id^="group-"]').first().getAttribute('id');
  await file.click();
  await sheet.waitFor({ state: 'detached' });
  await page.waitForTimeout(500);
  const card = await page.evaluate(({ group, name }) => [...document.querySelectorAll(`[id="${group}"] .hunk-card`)]
    .find(card => card.querySelector('.file-path .name')?.textContent === name)?.id, { group, name });
  assert(card && await inView(`[id="${card}"]`), `Picking ${name} did not bring its card on screen`);

  // Escape closes the sheet and gives focus back to the button.
  await button.click();
  await sheet.waitFor();
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
  assert(await button.evaluate(el => el === document.activeElement), 'Focus did not come back to the button');

  // Files A–Z: the sheet is the file tree, and a file jumps to its card.
  await view.locator('button').first().click();
  await page.waitForTimeout(500);
  const files = page.getByRole('dialog', { name: 'Files' });
  await button.click();
  await files.waitFor();
  const alphaFile = files.locator('[data-item-type="file"]').nth(3);
  const alphaName = await alphaFile.getAttribute('aria-label');
  await alphaFile.click();
  await files.waitFor({ state: 'detached' });
  await page.waitForTimeout(500);
  const alphaCards = await page.evaluate(name => [...document.querySelectorAll('.file-card')]
    .filter(card => card.querySelector('.file-path .name')?.textContent === name).map(card => card.id), alphaName);
  let alphaInView = false;
  for (const id of alphaCards) alphaInView ||= await inView(`[id="${id}"]`);
  assert(alphaInView, `Picking ${alphaName} in Files A–Z did not bring its card on screen`);
  await view.locator('button').first().click();

  await page.setViewportSize({ width: 1280, height: 900 });
  assert(!(await button.isVisible()), 'The navigator button shows on a wide screen');
  if (errors.length) throw new Error(errors.join('\n'));
  return { buttonOnPhone: true, listsConcerns: listed, concernJump: target, fileJump: name, escapeCloses: true, alphaJump: alphaName, hiddenOnDesktop: true, errors };
}
