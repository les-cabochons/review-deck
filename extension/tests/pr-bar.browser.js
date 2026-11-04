// Run through playwright-cli run-code --filename=extension/tests/pr-bar.browser.js.
// Uses the demo data (`npm run ext:demo`). Scrolled down, the compact PR header stays at the top with the title and
// the review controls, and nothing else that sticks (tab bar, files toolbar, navigator) or a concern a jump lands on
// hides under it.
async page => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const size = page.viewportSize();
  await page.setViewportSize({ width: 1280, height: 720 });
  // From a blank page: a goto to the URL already open only changes the hash and keeps the page's state.
  await page.goto('about:blank');
  await page.goto('http://127.0.0.1:5173/dev/?pr=485&repo=users-sdk#files');
  const f = page.frameLocator('#frame');
  await f.locator('.file-header').first().waitFor();
  await f.locator('.analyzing-note').waitFor({ state: 'detached', timeout: 60000 });
  const view = f.locator('.files-toolbar .mode-toggle').first().locator('button').first();
  if ((await view.textContent()).trim() !== 'Guided') await view.click();
  await f.locator('.group-section').first().waitFor();
  const scrollTo = y => f.locator('body').evaluate((_, y) => window.scrollTo(0, y), y);
  const pause = () => page.waitForTimeout(300);
  const box = selector => f.locator(selector).first().evaluate(el => {
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
  });
  const shown = () => f.locator('.pr-bar').evaluate(el => getComputedStyle(el).visibility === 'visible');
  const result = {};

  // Given the top of the page, the full header shows and the compact one stays out of the way.
  await scrollTo(0);
  await pause();
  assert(!(await shown()), 'The compact header shows while the full header is on screen');

  // Given a scroll past the header, the compact one holds the title and the review controls. Mid-page: at the very
  // bottom the navigator's container ends and pushes it up, with or without the compact header.
  await scrollTo(1500);
  await pause();
  assert(await shown(), 'The compact header did not show after scrolling past the full header');
  const bar = await box('.pr-bar');
  assert(bar.top === 0, `The compact header is not at the top: ${bar.top}px`);
  const title = await f.locator('.pr-bar-title').getAttribute('title');
  assert(title === (await f.locator('.pr-header h1').innerText()).replace(/\s*!\d+$/, ''), 'The compact header has another title');
  assert(await f.locator('.pr-bar .review-button button').isVisible(), 'Review is missing from the compact header');
  assert(await f.locator('.pr-bar .vote-button').isVisible(), 'Approve is missing from the compact header');

  // Nothing else that sticks hides under it.
  const toolbar = await box('.files-toolbar');
  assert(toolbar.top >= bar.bottom, `The files toolbar (${toolbar.top}px) sticks under the compact header (${bar.bottom}px)`);
  const navigator = await box('.navigator');
  assert(navigator.top >= toolbar.bottom - 1, `The navigator (${navigator.top}px) sticks under the files toolbar (${toolbar.bottom}px)`);
  result.stuck = { bar: bar.bottom, toolbar: toolbar.bottom, navigator: navigator.top };

  // A jump to a concern lands below the toolbar, not behind the two bars.
  await scrollTo(0);
  await pause();
  // The second concern: the last one may sit lower only because the page ends.
  await f.locator('.nav-group-title').nth(1).click();
  await page.waitForTimeout(600);
  const id = await f.locator('.group-section').nth(1).getAttribute('id');
  const landed = await box(`[id="${id}"]`);
  const toolbarNow = await box('.files-toolbar');
  assert(landed.top >= toolbarNow.bottom - 1, `The concern a jump landed on (${landed.top}px) is behind the toolbar (${toolbarNow.bottom}px)`);
  assert(landed.top <= toolbarNow.bottom + 16, `The jump stopped short: the concern is at ${landed.top}px, the toolbar ends at ${toolbarNow.bottom}px`);
  result.jump = { concern: landed.top, toolbar: toolbarNow.bottom };

  // Given a review being written from the compact header, scrolling back up keeps it on screen.
  await scrollTo(1500);
  await pause();
  await f.locator('.pr-bar .review-button button').click();
  await f.locator('.pr-bar .review-panel').waitFor();
  await scrollTo(0);
  await pause();
  assert(await shown(), 'The compact header hid its open review panel when scrolling back up');
  await f.locator('.pr-bar .review-panel').getByRole('button', { name: 'Cancel', exact: true }).click();
  await pause();
  assert(!(await shown()), 'The compact header stayed at the top after closing its review panel');

  // On the Overview tab, the tab bar sticks under the compact header.
  await f.getByRole('tab', { name: 'Overview' }).click();
  await scrollTo(100000);
  await pause();
  if (await shown()) {
    const tabs = await box('.pr-tabs');
    assert(tabs.top >= bar.bottom - 1, `The tab bar (${tabs.top}px) sticks under the compact header (${bar.bottom}px)`);
    result.overviewTabs = tabs.top;
  } else result.overviewTabs = 'page too short to scroll past the header';

  if (size) await page.setViewportSize(size);
  if (errors.length) throw new Error(errors.join('\n'));
  return result;
}
