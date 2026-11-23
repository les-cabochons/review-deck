// Run through playwright-cli run-code --filename=extension/tests/infra-modules.browser.js, with npm run ext:dev running,
// the demo data built (npm run ext:demo) and the write harness built (npm run ext:test:browser). Opens demo PR !473,
// which changes Terraform in three folders, and checks the Infra tab's module map: a card per folder listing its
// changes, arrows labelled with the outputs that pass between modules, a click that leads to a module's section,
// and the outline that replaces the drawing on a phone.
async page => {
  await page.addInitScript(() => {
    const wait = async (condition, message) => {
      for (let i = 0; i < 300; i++) {
        if (condition()) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(message);
    };
    window.check = { wait, assert: (condition, message) => { if (!condition) throw new Error(message); } };
  });

  await page.setViewportSize({ width: 1400, height: 1000 });
  // The Overview card's thumbnail is the module map, not one folder's diagram.
  await page.goto('http://127.0.0.1:5173/test-dist/index.html?snapshot=demo-473#overview');
  await page.evaluate(async () => {
    const { wait, assert } = check;
    await wait(() => document.querySelector('.infra-card-thumb .relation-node'), 'The Infrastructure card has no thumbnail');
    const cards = [...document.querySelectorAll('.infra-card-thumb .relation-node-title')].map(t => t.textContent);
    assert(cards.includes('modules/storage') && cards.includes('envs/prod'), `The thumbnail is not the module map: ${cards}`);
    assert(!document.querySelector('.infra-card-foot'), 'The card still has its footnote');
    document.querySelector('.infra-card-head .link-button').click();
  });
  await page.evaluate(async () => {
    const { wait, assert } = check;
    await wait(() => document.querySelector('.infra-module-map .relation-map svg'), 'The Infra tab did not draw its module map');
    const cards = [...document.querySelectorAll('.infra-module-map .relation-node')].map(n => n.querySelector('.relation-node-title').textContent);
    assert(
      ['envs/prod', 'modules/function-app', 'modules/storage', 'modules/network', 'Azure/naming/azurerm'].every(c => cards.includes(c)),
      `Module cards: ${cards}`,
    );
    // A changed module lists its changes, riskiest first.
    const storage = [...document.querySelectorAll('.infra-module-map .relation-node')].find(n => n.querySelector('.relation-node-title').textContent === 'modules/storage');
    const rows = [...storage.querySelectorAll('.relation-row')].map(r => r.textContent);
    assert(rows[0] === '−/+Storage account this' && rows.includes('+output queue_name'), `Storage rows: ${rows}`);
    // The new input reads a new output: the arrow from storage to the function app says so.
    const edges = [...document.querySelectorAll('.infra-module-map .relation-edge')].map(e => `${e.getAttribute('class')}|${e.querySelector('title').textContent}`);
    assert(
      edges.some(e => e.includes('touched') && e.includes('modules/function-app uses account_name and queue_name from modules/storage')),
      `No arrow for the new queue: ${edges.join(' / ')}`,
    );
    // The folders still each have their section, with its own diagram.
    assert(document.querySelectorAll('.infra-module').length === 3, 'Each changed folder should keep its section');
  });

  // Expand shows the map over the whole page, fitted whole; Escape puts it back.
  await page.locator('.infra-module-map .diagram-canvas-controls button', { hasText: 'Expand' }).click();
  await page.evaluate(async () => {
    const { wait, assert } = check;
    await wait(() => document.querySelector('.diagram-expanded .relation-node'), 'Expand did not show the map over the page');
    const box = document.querySelector('.diagram-expanded .diagram-canvas').getBoundingClientRect();
    const cards = [...document.querySelectorAll('.diagram-expanded .relation-node')].map(n => n.getBoundingClientRect());
    assert(cards.every(c => c.left >= box.left && c.right <= box.right && c.top >= box.top && c.bottom <= box.bottom), 'The expanded map does not show every card');
    assert(document.querySelector('.infra-module-map .diagram-canvas-away'), 'The page lost the place the map came from');
  });
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const { wait, assert } = check;
    await wait(() => !document.querySelector('.diagram-expanded'), 'Escape did not close the expanded map');
    assert(document.querySelector('.infra-module-map .relation-map svg'), 'The map did not come back to the page');
  });

  // A pick in the expanded map closes it, and the page shows what was picked.
  await page.locator('.infra-module-map .diagram-canvas-controls button', { hasText: 'Expand' }).click();
  await page.locator('.diagram-expanded').getByRole('button', { name: /^modules\/storage: .*Show it\.$/ }).click();
  await page.evaluate(async () => {
    const { wait, assert } = check;
    await wait(() => !document.querySelector('.diagram-expanded'), 'A pick did not close the expanded map');
    await wait(() => document.activeElement?.classList.contains('infra-module'), 'Picking a module did not move to its section');
    const heading = document.activeElement.querySelector('h3').textContent;
    assert(heading === 'modules/storage/', `Picking storage moved to ${heading}`);
  });

  // On a phone, the same map is an outline: each root, then the modules it calls.
  await page.setViewportSize({ width: 390, height: 900 });
  return page.evaluate(async () => {
    const { wait, assert } = check;
    await wait(() => document.querySelector('.infra-outline'), 'A phone did not get the outline');
    assert(!document.querySelector('.infra-module-map .relation-map'), 'A phone still draws the module map');
    const heads = [...document.querySelectorAll('.infra-outline-head')].map(h => h.firstElementChild.textContent);
    assert(heads[0] === 'envs/prod', `The outline does not start at the root: ${heads}`);
    assert(document.querySelector('.infra-outline-callees')?.textContent.includes('modules/storage'), 'The called modules are not indented under the root');
    const gets = [...document.querySelectorAll('.infra-outline-gets')].map(g => g.textContent);
    assert(gets.some(g => g.includes('~ account_name and ~ queue_name from modules/storage')), `What the function app gets: ${gets}`);
    assert(document.documentElement.scrollWidth <= innerWidth, 'The outline scrolls sideways');
    return 'infra module map: cards, rows, output arrows, pick to section, and the phone outline checked';
  });
}
