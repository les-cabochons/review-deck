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

    // The list: the links' names, loose matches on one line, and the concern on its own. No "start here".
    const list = text('.concern-list');
    assert(!/start here/i.test(list), 'The list still says where to start');
    assert(list.includes('StorageCleanupReport'), 'The links don\'t name their symbols');
    assert(list.includes('through member names only'), 'Loose matches are not said to be loose');
    assert(list.includes('reviewable on its own'), 'No concern is said to stand alone');
    assert(!/Tests |Tested by/.test(list), 'Test files still link concerns');

    // Back to the author's.
    toggle('Written by').click();
    await wait(() => document.querySelector('.description .card-body') && !document.querySelector('.generated-description'), 'The toggle did not go back to the author\'s description');
  });

  // Files: a concern's flow, and a click on a change. The harness keeps the guide it saved, so this is a reopened one.
  await page.reload();
  await page.evaluate(async () => {
    const { wait, assert } = check;
    await wait(() => document.querySelector('.summary-groups'), 'The saved guide did not load');
    [...document.querySelectorAll('.pr-tabs [role=tab]')].find(t => t.textContent.startsWith('Files')).click();
    await wait(() => document.querySelector('.concern-flow .relation-map svg'), 'No concern showed how its changes connect');
    // A box shows only its changes; a second click, all of them. An arrow shows only the changes behind it.
    const section = document.querySelector('.concern-flow').closest('.group-section');
    const cards = () => section.querySelectorAll('.hunk-card').length;
    const all = cards();
    const box = [...section.querySelectorAll('.concern-flow .relation-node.selectable')].find(n => /· \d+ changes/.test(n.textContent));
    const count = Number(/· (\d+) changes/.exec(box.textContent)[1]);
    box.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wait(() => cards() === count, `A box of ${count} changes left ${cards()} of ${all} showing`);
    assert(section.querySelector('.flow-focus')?.textContent.startsWith(`Showing ${count} changes of ${all}`), `Focus line: "${section.querySelector('.flow-focus')?.textContent}"`);
    assert(box.classList.contains('selected'), 'The picked box is not drawn as picked');
    box.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wait(() => cards() === all && !section.querySelector('.flow-focus'), 'A second click did not show every change again');
    const arrow = section.querySelector('.concern-flow .relation-edge.selectable');
    arrow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wait(() => section.querySelector('.flow-focus'), 'An arrow click did not pick its changes');
    assert(cards() >= 2 && cards() < all, `An arrow left ${cards()} of ${all} changes showing`);
    section.querySelector('.flow-focus .link-button').click();
    await wait(() => cards() === all, 'Show all did not show every change again');
    // An arrow answers the pointer anywhere along it, and its tooltip names both ends.
    const edge = document.querySelector('.concern-flow .relation-edge');
    const tooltip = edge.querySelector(':scope > title').textContent;
    assert(/ uses |use each other/.test(tooltip) && !tooltip.includes('\u0000') && !tooltip.includes('#'), `Arrow tooltip: "${tooltip}"`);
    const hit = edge.querySelector('.relation-edge-hit');
    const middle = hit.getPointAtLength(hit.getTotalLength() / 2);
    const svg = hit.ownerSVGElement.getBoundingClientRect();
    const scale = svg.width / hit.ownerSVGElement.viewBox.baseVal.width;
    const found = document.elementFromPoint(svg.left + middle.x * scale + 4 * scale, svg.top + middle.y * scale);
    assert(found?.closest('.relation-edge') === edge, `The pointer 4 px off the line found ${found?.outerHTML.slice(0, 80)}`);
    // Every box: the function, then its file. No "start here", and no `make` linking two files.
    const subtitles = [...document.querySelectorAll('.concern-flow .relation-node-subtitle')].map(t => t.textContent);
    assert(subtitles.length > 0 && subtitles.every(t => /^[\w.-]+\.\w+( · \d+ changes)?$/.test(t)), `A box's second line isn't its file: ${subtitles}`);
    assert(!document.querySelector('.concern-flow')?.textContent.includes('start here'), 'A map still says where to start');
    const boxes = [...document.querySelectorAll('.concern-flow .relation-node title')].map(t => t.textContent);
    assert(!boxes.some(t => /\.test\.|\/tests?\//.test(t)), `A test file is in a concern's map: ${boxes.filter(t => /test/.test(t))}`);
  });

  // How to read it, then Hide diagrams: every map goes, after a reload too, and the ⋯ menu brings them back.
  await page.evaluate(async () => {
    const { wait, assert } = check;
    const link = label => [...document.querySelectorAll('.concern-flow .diagram-controls button')].find(b => b.textContent === label);
    link('How to read it').click();
    await wait(() => document.querySelector('.concern-flow .how-to-read'), 'How to read it did not open');
    assert(document.querySelector('.how-to-read').textContent.includes('An arrow from A to B means B uses something A defines'), 'The explanation is not the one for a concern\'s map');
    link('Hide diagrams').click();
    await wait(() => !document.querySelector('.concern-flow'), 'Hide diagrams left a map in Files');
  });
  await page.reload();
  await page.evaluate(async () => {
    const { wait, assert } = check;
    await wait(() => document.querySelector('.group-section'), 'Files did not load again');
    await new Promise(resolve => setTimeout(resolve, 1000));
    assert(!document.querySelector('.concern-flow'), 'A map came back after a reload');
  });
  await page.click('.pr-header .more-menu');
  await page.click('text=Show change diagrams');
  await page.evaluate(async () => {
    await check.wait(() => document.querySelector('.concern-flow .relation-map svg'), 'The ⋯ menu did not bring the maps back');
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
