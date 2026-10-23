// Run through playwright-cli run-code --filename=extension/tests/explorer-height.browser.js.
// Uses a local mock in a short window, so the file tree is taller than the screen in both views. The tree's
// bottom stays on screen at every scroll position, so its last file is reachable by scrolling the tree alone.
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
  if (size) await page.setViewportSize(size);
  return result;
}
