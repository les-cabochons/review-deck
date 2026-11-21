// Run through playwright-cli run-code --filename=extension/tests/presence.browser.js.
// Uses the demo data (`npm run ext:demo`) and the dev host's made-up people (`presence=demo`, app/localHost.ts): the
// PR's first reviewer reviewing now with 3 drafts, its second away with 2 drafts, and Samuel Côté here, who isn't a
// reviewer. The headers show the faces of those here, the reviewers list says what each does, and leaving the PR
// removes your own record.
async page => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const size = page.viewportSize();
  await page.setViewportSize({ width: 1280, height: 800 });
  const f = page.frameLocator('#frame');
  const ownRecords = () => f.locator('body').evaluate(() =>
    Object.values(JSON.parse(localStorage.getItem('review-deck.local.presence.482') ?? '{}')).filter(r => !String(r.id).startsWith('demo-')));
  const result = {};

  // Given no one else on the PR, the header shows no faces.
  await page.goto('about:blank');
  await page.goto('http://127.0.0.1:5173/dev/?pr=482&repo=users-sdk#overview');
  await f.locator('.pr-header h1').waitFor();
  await f.locator('.overview-side .people').first().waitFor();
  await page.waitForTimeout(1000);
  assert(await f.locator('.presence-stack').count() === 0, 'Faces show while no one else is on the PR');

  // Given two people here and one away with drafts, the header shows the two here, reviewing first.
  await page.goto('about:blank');
  await page.goto('http://127.0.0.1:5173/dev/?pr=482&repo=users-sdk&presence=demo#overview');
  const stack = f.locator('.pr-header .presence-stack');
  await stack.waitFor();
  assert((await stack.locator('.presence-label').innerText()).trim() === '2 here', `The header says "${await stack.locator('.presence-label').innerText()}"`);
  assert(await stack.locator('.presence-faces .presence-avatar').count() === 2, 'The header shows another number of faces');
  assert(await stack.locator('.presence-faces .presence-avatar').first().locator('.presence-badge.reviewing').count() === 1, 'The reviewing person is not first, or has no pencil');

  // Hovering the faces says who does what, and where.
  const card = stack.locator('.presence-card');
  assert(!(await card.isVisible()), 'The card shows before hovering');
  await stack.hover();
  await card.waitFor();
  const cardText = await card.innerText();
  assert(/Reviewing · 3 draft comments/.test(cardText) && /On Files/.test(cardText), `The card does not say who reviews where: ${cardText}`);
  assert(/Samuel Côté/.test(cardText) && /Viewing/.test(cardText), `The card misses the viewer: ${cardText}`);
  result.card = cardText.split('\n');

  // The reviewers list says what each reviewer does, the one away included, and lists the others below.
  const statuses = await f.locator('.overview-side .editable-reviewer .presence-status').allInnerTexts();
  assert(statuses.some(s => s === 'Reviewing now · 3 drafts'), `No reviewer reviews now: ${statuses}`);
  assert(statuses.some(s => /^Review started 1 day ago · 2 drafts not sent$/.test(s)), `No reviewer has a review started: ${statuses}`);
  const others = f.locator('.presence-others');
  assert((await others.locator('h3').innerText()).trim().toLowerCase() === 'also on this pull request', 'The others have another heading');
  assert(/Samuel Côté\s*Here now/.test(await others.locator('li').innerText()), 'The viewer who is not a reviewer is missing');
  result.statuses = statuses;

  // Scrolled down, the compact header keeps the faces.
  await f.locator('body').evaluate(() => window.scrollTo(0, 1500));
  await page.waitForTimeout(300);
  assert(await f.locator('.pr-bar .presence-stack').isVisible(), 'The compact header lost the faces');

  // Your own page checked in, and leaving the PR without drafts removes its record.
  const mine = await ownRecords();
  assert(mine.length === 1 && mine[0].tab === 'overview' && mine[0].drafts === 0, `Your record is not as expected: ${JSON.stringify(mine)}`);
  await f.locator('body').evaluate(() => window.scrollTo(0, 0));
  await f.locator('.breadcrumb button.crumb-link').click();
  await f.locator('.pr-row').first().waitFor();
  await page.waitForTimeout(300);
  assert((await ownRecords()).length === 0, 'Your record stayed after leaving without drafts');

  if (size) await page.setViewportSize(size);
  assert(errors.length === 0, `Page errors: ${errors.join('; ')}`);
  return result;
}
