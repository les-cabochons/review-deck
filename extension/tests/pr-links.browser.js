// Run through playwright-cli run-code --filename=extension/tests/pr-links.browser.js.
// Uses the demo data (`npm run ext:demo`). Commits link to the host's commit page, file paths to the host's file page,
// and the Overview's links into the Files tab land on what they name: a code comment's file label scrolls to the
// comment, in the guided view and in the A–Z one, and "update N" opens the Files tab.
async page => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const size = page.viewportSize();
  await page.setViewportSize({ width: 1280, height: 720 });
  const commit = 'd563fa24714802c014af0b5ca2a7fa23b5ddd320';
  const open = async (tab) => {
    // From a blank page: a goto to the URL already open only changes the hash and keeps the page's state.
    await page.goto('about:blank');
    await page.goto(`http://127.0.0.1:5173/dev/?pr=482&repo=users-sdk#${tab}`);
  };
  const f = page.frameLocator('#frame');
  const result = {};

  // Given the Overview, the update's commit links to its commit page, out of Azure DevOps' iframe.
  await open('overview');
  const commitLink = f.locator('.event-commits a.commit-link').first();
  await commitLink.waitFor();
  result.timelineCommit = { href: await commitLink.getAttribute('href'), target: await commitLink.getAttribute('target') };
  assert(result.timelineCommit.href === `https://github.com/pingdotgg/t3code/commit/${commit}`, `timeline commit link: ${result.timelineCommit.href}`);
  assert(result.timelineCommit.target === '_top', 'timeline commit link should leave the iframe');

  // Given the Commits tab, the commit's title links to the same page.
  await f.getByRole('tab', { name: /^Commits/ }).click();
  const subject = f.locator('.commit-subject a.commit-link').first();
  await subject.waitFor();
  result.commitsTab = await subject.getAttribute('href');
  assert(result.commitsTab === `https://github.com/pingdotgg/t3code/commit/${commit}`, `Commits tab link: ${result.commitsTab}`);

  // Given the Files tab, a file's path links to its page at the compared update, in a new tab like "View file".
  await f.getByRole('tab', { name: /^Files/ }).click();
  await f.locator('.file-header').first().waitFor();
  await f.locator('.meta-stats .grouping-status').waitFor({ state: 'detached', timeout: 60000 });
  const path = f.locator('.file-header a.file-path').first();
  result.filePath = { href: await path.getAttribute('href'), target: await path.getAttribute('target') };
  assert(/^https:\/\/github\.com\/pingdotgg\/t3code\/blob\/[0-9a-f]{40}\//.test(result.filePath.href), `file path link: ${result.filePath.href}`);
  assert(result.filePath.target === '_blank', 'file path link should open a new tab');

  // Guided or Files A–Z: the toggle in the Files toolbar.
  const showView = name => f.locator('.files-toolbar').getByRole('button', { name, exact: true }).click();
  // Given a code comment on the Overview, its file label opens the Files tab scrolled to that comment.
  const landsOnComment = async (label) => {
    await f.getByRole('tab', { name: /^Overview/ }).click();
    const fileLabel = f.locator('.timeline-thread .thread-file button').filter({ hasText: 'client.ts' });
    await fileLabel.waitFor();
    await fileLabel.click();
    await f.locator('.files-tab').waitFor();
    await page.waitForTimeout(600);
    const box = await f.locator('.files-content [id^="thread-"]').filter({ hasText: 'trailing slash' }).first().evaluate(el => {
      const r = el.getBoundingClientRect();
      const bar = document.querySelector('.pr-tabs')?.getBoundingClientRect().bottom ?? 0;
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), stickyBottom: Math.round(bar), height: window.innerHeight };
    });
    result[label] = box;
    assert(box.top >= box.stickyBottom && box.top < box.height, `${label}: the comment is out of sight (${JSON.stringify(box)})`);
  };
  await showView('Guided');
  await landsOnComment('guided');
  await showView('Files A–Z');
  await landsOnComment('alpha');
  // Back to the guided view, which the other tests expect.
  await showView('Guided');

  // Given an update on the Overview, its link opens the Files tab.
  await f.getByRole('tab', { name: /^Overview/ }).click();
  await f.getByRole('button', { name: 'update 1', exact: true }).click();
  await f.locator('.files-tab').waitFor();
  result.updateOpensFiles = true;

  await page.setViewportSize(size);
  if (errors.length) throw new Error(errors.join('\n'));
  return result;
}
