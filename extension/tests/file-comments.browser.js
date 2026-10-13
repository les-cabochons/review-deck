// Run through playwright-cli run-code --filename=extension/tests/file-comments.browser.js.
// Uses the local mock and its in-memory writes; stubs window.open to capture the View file URL.
async page => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173/dev/?pr=17901&repo=t3code#files');
  const f = page.frameLocator('#frame');
  await f.locator('.file-header').first().waitFor();
  await f.locator('.analyzing-note').waitFor({ state: 'detached', timeout: 60000 });
  await page.waitForTimeout(1500);
  const header = f.locator('.file-header').first();
  const path = await header.locator('.file-path').getAttribute('title');
  // View file opens the file at the compared update's head commit.
  const opened = [];
  await f.locator('body').evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(url); return null; }; });
  await header.getByRole('button', { name: `More options for ${path}`, exact: true }).click();
  await f.getByRole('menuitem', { name: /^View file/ }).click();
  opened.push(...await f.locator('body').evaluate(() => window.__opened));
  // File comment: open the composer, post a single comment, and see the thread under the header.
  await header.getByRole('button', { name: `Comment on ${path}`, exact: true }).click();
  const composer = f.locator('.file-comments .comment-composer').first();
  await composer.locator('[contenteditable], textarea').first().fill('File-level check');
  await composer.getByRole('button', { name: 'Add single comment' }).click();
  await f.locator('.file-comments .thread').filter({ hasText: 'File-level check' }).first().waitFor();
  const count = await header.locator('.file-comment-button').innerText();
  await f.locator('.file-card, .hunk-card').first().screenshot({ path: 'output/playwright/file-comment.png' });
  if (errors.length) throw new Error(errors.join('\n'));
  return { path, opened, count, errors };
}
