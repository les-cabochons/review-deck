// Run through playwright-cli run-code --filename=extension/tests/pr-bar.browser.js.
// Uses the demo data (`npm run ext:demo`). Scrolled down, the compact PR header stays at the top with the title and
// the review controls, and nothing else that sticks (the tab row with the files toolbar in it, the navigator) or a
// concern a jump lands on hides under it. Its Review button edits the same review as the full header's. The files
// toolbar has a line of its own under the tabs, as wide as the diffs, and the tabs stay in place from tab to tab.
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
  await f.locator('.meta-stats .grouping-status').waitFor({ state: 'detached', timeout: 60000 });
  await f.locator('.files-toolbar').getByRole('button', { name: 'Guided', exact: true }).click();
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

  // Nothing else that sticks hides under it. The files toolbar sits in the tab row, so one row sticks there.
  const tabRow = await box('.pr-tabs');
  assert(tabRow.top >= bar.bottom - 1, `The tab row (${tabRow.top}px) sticks under the compact header (${bar.bottom}px)`);
  const toolbar = await box('.files-toolbar');
  assert(toolbar.top >= tabRow.top && toolbar.bottom <= tabRow.bottom, `The files toolbar (${toolbar.top}px to ${toolbar.bottom}px) is not in the tab row (${tabRow.top}px to ${tabRow.bottom}px)`);
  const navigator = await box('.navigator');
  assert(navigator.top >= tabRow.bottom - 1, `The navigator (${navigator.top}px) sticks under the tab row (${tabRow.bottom}px)`);
  result.stuck = { bar: bar.bottom, tabRow: tabRow.bottom, navigator: navigator.top };

  // The tab row's bottom border is its edge from one side of the page to the other: it used to show only in the
  // page's side padding, with the toolbar over the rest of it. The tabs stay in reach on the Files tab.
  const onEdge = await f.locator('.pr-tabs').evaluate(row => {
    const y = row.getBoundingClientRect().bottom - 0.75; // inside the 1px border
    return [4, innerWidth / 2, innerWidth - 4].map(x => document.elementFromPoint(x, y) === row);
  });
  assert(onEdge.every(Boolean), `Something covers the tab row's bottom border (left, middle, right): ${onEdge}`);
  const tabInReach = await f.getByRole('tab', { name: 'Overview' }).evaluate(tab => {
    const r = tab.getBoundingClientRect();
    return tab.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  });
  assert(tabInReach, 'Something covers the Overview tab while the Files tab is scrolled');
  const barEdge = await f.locator('.pr-bar').evaluate(el => {
    const s = getComputedStyle(el);
    return { shadow: s.boxShadow, border: s.borderBottomColor };
  });
  assert(barEdge.shadow === 'none', `The compact header casts a shadow on the tab row: ${barEdge.shadow}`);
  assert(/, 0\)$/.test(barEdge.border), `The compact header draws a line between itself and the tab row: ${barEdge.border}`);

  // A jump to a concern lands below the tab row, not behind the two bars.
  await scrollTo(0);
  await pause();
  // The second concern: the last one may sit lower only because the page ends.
  await f.locator('.nav-group-title').nth(1).click();
  await page.waitForTimeout(600);
  const id = await f.locator('.group-section').nth(1).getAttribute('id');
  const landed = await box(`[id="${id}"]`);
  const tabRowNow = await box('.pr-tabs');
  assert(landed.top >= tabRowNow.bottom - 1, `The concern a jump landed on (${landed.top}px) is behind the tab row (${tabRowNow.bottom}px)`);
  assert(landed.top <= tabRowNow.bottom + 16, `The jump stopped short: the concern is at ${landed.top}px, the tab row ends at ${tabRowNow.bottom}px`);
  result.jump = { concern: landed.top, tabRow: tabRowNow.bottom };

  // Given a window wide enough for the page to center (the dev shell leaves it 1360px of 1600px), the toolbar is on
  // its own line under the tabs and starts where the diffs do, at the page's side margin, while the tabs are
  // centered; the navigator was measured under both lines. On the Overview, the tabs are where they were.
  const left = selector => f.locator(selector).first().evaluate(el => Math.round(el.getBoundingClientRect().left));
  await page.setViewportSize({ width: 1600, height: 720 });
  await scrollTo(1500);
  await pause();
  const tabs = await box('.pr-tabs .bolt-tabbar-tabs');
  const toolbarLine = await box('.files-toolbar');
  assert(toolbarLine.top >= tabs.bottom - 1, `The toolbar (${toolbarLine.top}px) is not under the tabs (${tabs.bottom}px)`);
  const lefts = { tab: await left('.pr-tabs [role=tab]'), toolbar: await left('.files-toolbar'), diffs: await left('.files-layout') };
  assert(lefts.toolbar === lefts.diffs, `The toolbar (${lefts.toolbar}px) does not start where the diffs do (${lefts.diffs}px)`);
  assert(lefts.tab > lefts.toolbar, `The tabs (${lefts.tab}px) are not centered past the toolbar's margin (${lefts.toolbar}px)`);
  const wideRow = await box('.pr-tabs');
  const wideNavigator = await box('.navigator');
  assert(wideNavigator.top >= wideRow.bottom - 1 && wideNavigator.top <= wideRow.bottom + 16, `The navigator (${wideNavigator.top}px) is not right under the tab row (${wideRow.bottom}px)`);
  await f.getByRole('tab', { name: 'Overview' }).click();
  await f.locator('.overview').waitFor();
  const overviewTab = await left('.pr-tabs [role=tab]');
  assert(overviewTab === lefts.tab, `The tabs moved between Files (${lefts.tab}px) and Overview (${overviewTab}px)`);
  await f.getByRole('tab', { name: /^Files/ }).click();
  await f.locator('.files-toolbar').waitFor();
  result.wide = { ...lefts, overviewTab, tabRow: wideRow.bottom, navigator: wideNavigator.top };
  await page.setViewportSize({ width: 1280, height: 720 });

  // Given a review started in the full header, the compact header's Review opens on the same summary and verdict.
  await scrollTo(0);
  await pause();
  await f.locator('.pr-header .review-button button').click();
  await f.locator('.pr-header .review-panel textarea').fill('One review, two buttons');
  await f.locator('.pr-header .review-panel').getByRole('radio', { name: /^Wait for author/ }).check();
  await scrollTo(1500);
  await pause();
  await f.locator('.pr-bar .review-button button').click();
  await f.locator('.pr-bar .review-panel').waitFor();
  assert(await f.locator('.pr-bar .review-panel textarea').inputValue() === 'One review, two buttons', 'The compact header opened another, empty review');
  assert(await f.locator('.pr-bar .review-panel').getByRole('radio', { name: /^Wait for author/ }).isChecked(), 'The compact header lost the verdict');
  assert(await f.locator('.pr-header .review-panel').count() === 0, 'Both review panels are open');

  // Given that review open in the compact header, scrolling back up keeps it on screen.
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
