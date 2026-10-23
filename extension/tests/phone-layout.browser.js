// Run through playwright-cli run-code --filename=extension/tests/phone-layout.browser.js.
// Opens the local mock's Files tab at a phone's width (412 px, like a Pixel), without the dev shell's side
// navigation, and checks that nothing runs past the screen and that concern titles and file names stay readable.
async page => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto('http://127.0.0.1:5173/dist/review.html?local&pr=17901&repo=t3code#files');
  await page.locator('.file-header').first().waitFor();
  await page.locator('.analyzing-note').waitFor({ state: 'detached', timeout: 60000 });
  await page.waitForTimeout(1500);
  const view = page.locator('.mode-toggle').first();
  if (!(await view.innerText()).includes('Guided')) await view.locator('button').first().click();
  await page.waitForTimeout(500);

  const layout = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const actions = [...document.querySelectorAll('.pr-actions > *')].map(el => Math.round(el.getBoundingClientRect().right));
    const titles = [...document.querySelectorAll('.group-header .gtitle')].map(el => Math.round(el.getBoundingClientRect().width));
    // A name is cut only if it would fit in its path's width; longer names may end in an ellipsis.
    const cutNames = [...document.querySelectorAll('.file-header .file-path')]
      .map(path => ({ path, name: path.querySelector('.name') }))
      .filter(({ path, name }) => name.scrollWidth <= path.clientWidth && name.scrollWidth > name.clientWidth)
      .map(({ path }) => path.title);
    return { width, scrollWidth: document.documentElement.scrollWidth, actions, titles, cutNames };
  });
  assert(layout.scrollWidth <= layout.width, `The page scrolls sideways: ${layout.scrollWidth} px wide in ${layout.width} px`);
  assert(layout.actions.every(right => right <= layout.width), `A PR action runs past the screen: ${layout.actions}`);
  assert(layout.titles.length > 0, 'No concern headers');
  assert(layout.titles.every(width => width >= 120), `A concern title is squeezed: ${layout.titles} px`);
  assert(layout.cutNames.length === 0, `File names cut while their directory had room: ${layout.cutNames.join(', ')}`);
  if (errors.length) throw new Error(errors.join('\n'));
  return { noSidewaysScroll: true, actionsInside: true, titlesReadable: layout.titles, fileNamesWhole: true, errors };
}
