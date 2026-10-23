// Run through playwright-cli run-code --filename=extension/tests/explorer-height.browser.js.
// Uses a local mock in a short window, so the file tree is taller than the screen in both views. The tree's
// bottom stays on screen at every scroll position, so its last file and its Hide control are reachable without
// scrolling the page. Hidden, the tree's rail fits the visible window too.
async page => {
  const size = page.viewportSize();
  await page.setViewportSize({ width: 1280, height: 560 });
  await page.goto('http://127.0.0.1:5173/dev/?pr=17826&repo=t3code#files');
  const f = page.frameLocator('#frame');
  await f.locator('.file-header').first().waitFor();
  await f.locator('.analyzing-note').waitFor({ state: 'detached', timeout: 60000 });
  await page.waitForTimeout(1000);
  const result = {};
  for (const view of ['Guided', 'Files A–Z']) {
    const toggle = f.locator('.mode-toggle').first();
    if (!(await toggle.innerText()).includes(view)) await toggle.locator('button').first().click();
    await page.waitForTimeout(500);
    for (const y of [0, 100, 3000]) {
      await f.locator('body').evaluate((_, y) => window.scrollTo(0, y), y);
      await page.waitForTimeout(300);
      const { bottom, innerHeight, overflows } = await f.locator('.navigator').evaluate(nav => ({
        bottom: nav.getBoundingClientRect().bottom,
        innerHeight: nav.ownerDocument.defaultView.innerHeight,
        overflows: nav.scrollHeight > nav.clientHeight,
      }));
      if (!overflows) throw new Error(`${view}: the mock's tree fits on screen, so this check proves nothing`);
      if (bottom > innerHeight) throw new Error(`${view} at scroll ${y}: tree bottom ${bottom}px is below the ${innerHeight}px window`);
      result[`${view} @${y}`] = Math.round(innerHeight - bottom);
    }
  }
  await f.locator('body').evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const onScreen = locator => locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= el.ownerDocument.defaultView.innerHeight;
  });
  const hide = f.getByRole('button', { name: 'Hide file tree', exact: true });
  if (!(await onScreen(hide))) throw new Error('Hide file tree is off screen before the page scrolls');
  await hide.click();
  const show = f.getByRole('button', { name: 'Show file tree', exact: true });
  await show.waitFor();
  if (!(await onScreen(show))) throw new Error('The hidden tree\'s rail runs off screen');
  await show.click();
  await hide.waitFor();
  result.toggleOnScreen = true;
  if (size) await page.setViewportSize(size);
  return result;
}
