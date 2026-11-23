// Run through playwright-cli run-code --filename=extension/tests/generated-description.browser.js, with npm run ext:dev
// running, the T3 Code mock built (npm run ext:mock) and the write harness built (npm run ext:test:browser). Opens real
// T3 Code PR 17563 and checks the description card's toggle, the generated description (why from the commits, the map
// of concerns, the list), the flow inside a concern in Files, and the note a guide saved without relations shows.
async page => {
  await page.addInitScript(() => {
    const wait = async (condition, message) => {
      for (let i = 0; i < 600; i++) {
        if (condition()) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(message);
    };
    const text = selector => document.querySelector(selector)?.textContent ?? '';
    window.check = {
      wait,
      text,
      assert: (condition, message) => { if (!condition) throw new Error(message); },
      toggle: label => [...document.querySelectorAll('.description-source button')].find(b => b.textContent.startsWith(label)),
      saved: () => JSON.parse(localStorage.getItem('write-test-saved') ?? 'null'),
    };
  });

  await page.goto('http://127.0.0.1:5173/test-dist/index.html?saved&snapshot=t3code-17563#overview');
  await page.evaluate(async () => {
    const { wait, assert, text, toggle } = check;
    await wait(() => document.querySelector('.summary-groups'), 'The guide was not built');
    assert(toggle('Written by')?.getAttribute('aria-pressed') === 'true', 'The description did not open on the author\'s');
    toggle('Generated').click();
    await wait(() => document.querySelector('.generated-description .concern-list'), 'The generated description did not show');

    // Why: the commits as a changelog.
    const why = text('.generated-description section:first-child');
    assert(why.includes('make worktree cleanup work and show why it skipped') && why.includes('simplify cleanup settings and results'), `Why: "${why}"`);

    // The map: linked concerns drawn, the docs concern apart.
    await wait(() => document.querySelector('.generated-description .relation-map svg'), 'The map was not drawn');
    const drawn = document.querySelectorAll('.generated-description .relation-node:not(.apart)').length;
    const apart = document.querySelectorAll('.generated-description .relation-node.apart').length;
    assert(drawn === 4 && apart === 1, `Map: ${drawn} drawn, ${apart} apart`);
    assert(document.querySelectorAll('.generated-description .relation-edge').length > 0, 'The map has no link');

    // The list: where to start, the links' names, loose matches on one line, and the concern on its own.
    const list = text('.concern-list');
    assert(list.includes('Start here: it uses nothing the other concerns change.'), 'No starting concern');
    assert(list.includes('StorageCleanupReport'), 'The links don\'t name their symbols');
    assert(list.includes('through member names only'), 'Loose matches are not said to be loose');
    assert(list.includes('reviewable on its own'), 'No concern is said to stand alone');
    assert(text('.generated-missing').includes('how it was tested, and what could break'), 'The view does not say what it can\'t know');

    // The way back.
    document.querySelector('.generated-missing .link-button').click();
    await wait(() => toggle('Written by')?.getAttribute('aria-pressed') === 'true', 'The link back did not show the author\'s description');
  });

  // Files: a concern's flow, and a click on a change. The harness keeps the guide it saved, so this is a reopened one.
  await page.reload();
  await page.evaluate(async () => {
    const { wait, assert } = check;
    await wait(() => document.querySelector('.summary-groups'), 'The saved guide did not load');
    [...document.querySelectorAll('.pr-tabs [role=tab]')].find(t => t.textContent.startsWith('Files')).click();
    await wait(() => document.querySelector('.concern-flow .relation-map svg'), 'No concern showed how its changes connect');
    const node = document.querySelector('.concern-flow .relation-node.selectable');
    const target = node.querySelector('title').textContent.split('\n')[0];
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wait(() => document.querySelector('.hunk-card.flash'), `A click on "${target}" did not point at its change`);
    assert(document.querySelector('.concern-flow .relation-start'), 'No change is marked as where to start');
  });

  // A guide saved before relations were recorded: concerns without links, and the page says why.
  await page.evaluate(() => {
    const [comparison] = check.saved();
    delete comparison.review.relations;
    localStorage.setItem('write-test-saved', JSON.stringify([comparison]));
  });
  await page.evaluate(() => { location.hash = 'overview'; });
  await page.reload();
  return page.evaluate(async () => {
    const { wait, assert, text, toggle } = check;
    await wait(() => document.querySelector('.summary-groups'), 'The saved guide did not load');
    toggle('Generated').click();
    await wait(() => document.querySelector('.generated-note'), 'An old guide did not say why it has no links');
    assert(text('.generated-note').includes('Regroup'), 'The note does not say how to get the links');
    assert(!document.querySelector('.generated-description .relation-map'), 'An old guide drew a map without links');
    assert(!document.querySelector('.concern-list').textContent.includes('reviewable on its own'), 'An old guide called concerns unlinked');
    return 'generated description: toggle, why, map, list, flow, and an old guide checked';
  });
}
