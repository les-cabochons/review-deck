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
  await page.goto('http://127.0.0.1:5173/test-dist/index.html?snapshot=demo-473#infra');
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

  await page.getByRole('button', { name: /^modules\/storage: .*Show it\.$/ }).click();
  await page.evaluate(async () => {
    const { wait, assert } = check;
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
