// Run through playwright-cli run-code --filename=extension/tests/published-guide.browser.js, with npm run ext:dev
// running and the write harness built (npm run ext:test:browser). Uses the harness's saved guides (?saved) and demo
// PR !471: makes its saved guide one published from Ajour, then checks the Files toolbar's label and summary, a
// Regroup's own guide, and Publish's failure and success toasts.
async page => {
  await page.addInitScript(() => {
    const wait = async (condition, message) => {
      for (let i = 0; i < 600; i++) {
        if (condition()) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(message);
    };
    window.check = {
      wait,
      assert: (condition, message) => { if (!condition) throw new Error(message); },
      toolbar: () => document.querySelector('.files-toolbar .regroup')?.textContent ?? '',
      // Regroup and Publish guide are in the Files toolbar's gear. Opens it and returns the item, or null.
      menuItem: async label => {
        const item = () => [...document.querySelectorAll('[role^="menuitem"]')].find(i => i.textContent.trim() === label);
        if (!item()) document.querySelector('.files-toolbar [aria-label^="File view settings"]').click();
        for (let i = 0; i < 20 && !item(); i++) await new Promise(resolve => setTimeout(resolve, 50));
        return item() ?? null;
      },
      grouped: () => !!document.querySelector('.group-section'),
      toast: () => document.querySelector('.bolt-toast-message')?.textContent ?? '',
      summary: () => document.querySelector('.guide-summary')?.textContent ?? '',
      saved: () => JSON.parse(localStorage.getItem('write-test-saved') ?? 'null'),
    };
  });
  await page.goto('http://127.0.0.1:5173/test-dist/index.html?saved&snapshot=demo-471#files');
  await page.evaluate(() => check.wait(check.grouped, 'The first grouping did not finish'));
  await page.evaluate(() => {
    const [comparison] = check.saved();
    comparison.review.madeWith.app = 'ajour';
    comparison.review.summary = {
      problem: { text: ' Harness problem. ', source: 'inferred' },
      kinds: ['fix'],
      breaking: [{ text: '   ', hunkIds: [] }, { text: 'Harness break.', hunkIds: [] }],
      risks: [],
      tests: [],
      leftovers: [],
    };
    localStorage.setItem('write-test-saved', JSON.stringify([comparison]));
  });
  await page.reload();
  return page.evaluate(async () => {
    const { wait, assert, toolbar, menuItem, toast, summary, saved } = check;
    await wait(() => toolbar().includes('Published from Ajour'), `The published guide was not labelled: "${toolbar()}"`);
    assert(summary().includes('Harness problem.') && summary().includes('Harness break.'), `The summary did not show: "${summary()}"`);
    assert(document.querySelectorAll('.guide-summary li').length === 1, 'A blank summary line showed');

    (await menuItem('Regroup')).click();
    await wait(() => toolbar().includes('Your guide, for this session'), `A Regroup did not show the reader's guide: "${toolbar()}"`);
    assert(!toolbar().includes('Published from Ajour'), 'The reader\'s guide was labelled published');
    assert(summary().includes('Harness problem.'), 'The summary was dropped by the Regroup');
    assert(saved()[0].review.madeWith.app === 'ajour', 'A Regroup replaced the published guide');

    window.reviewTest.failSave = true;
    (await menuItem('Publish guide')).click();
    await wait(() => toast().startsWith('Could not publish your guide'), `No failure toast: "${toast()}"`);
    assert(toast().includes('Simulated save failure'), `The failure toast did not say why: "${toast()}"`);
    const publish = await menuItem('Publish guide');
    assert(toolbar().includes('Your guide, for this session') && publish && publish.getAttribute('aria-disabled') !== 'true', 'A failed Publish dropped the reader\'s guide');
    assert(saved()[0].review.madeWith.app === 'ajour', 'A failed Publish replaced the published guide');

    window.reviewTest.failSave = false;
    publish.click();
    await wait(() => toast() === 'Published your guide. Everyone who opens this comparison now sees it.', `No success toast: "${toast()}"`);
    assert(!toolbar().includes('Your guide') && !toolbar().includes('Published from Ajour'), `The toolbar still labelled the guide: "${toolbar()}"`);
    assert(summary().includes('Harness problem.'), 'The summary was dropped by the Publish');
    const published = saved()[0].review;
    assert(published.madeWith.app === undefined, 'Publish kept the Ajour marker');
    assert(published.summary?.problem.text === 'Harness problem.', 'Publish did not save the summary');
    return 'published guide: label, Regroup, Publish failure and success checked';
  });
}
