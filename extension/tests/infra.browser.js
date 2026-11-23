// Run through playwright-cli run-code --filename=extension/tests/infra.browser.js, with npm run ext:dev running, the
// demo data built (npm run ext:demo) and the write harness built (npm run ext:test:browser). Opens demo PR !472,
// which changes Terraform, and checks the Infrastructure card in Overview, the Infra tab it opens (its banner, the
// diagram, the list riskiest first, keyboard activation of a box) and that a pull request without Terraform shows neither.
async page => {
  await page.addInitScript(() => {
    const wait = async (condition, message) => {
      for (let i = 0; i < 300; i++) {
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
      tabs: () => [...document.querySelectorAll('.pr-tabs .bolt-tab')].map(t => t.textContent),
      rows: () => [...document.querySelectorAll('.infra-row')].map(r => ({
        id: r.id,
        name: r.querySelector('.infra-row-name')?.textContent ?? '',
        badges: [...r.querySelectorAll('.infra-badge')].map(b => b.textContent.trim()),
        reason: r.querySelector('.infra-reason')?.textContent ?? '',
      })),
    };
  });

  await page.goto('http://127.0.0.1:5173/test-dist/index.html?snapshot=demo-472#overview');
  await page.evaluate(async () => {
    const { wait, assert, text, tabs } = check;
    await wait(() => document.querySelector('.infra-card-rows'), 'The Infrastructure card did not show its resources');
    const head = text('.infra-card-head');
    for (const count of ['1 destroy likely', '1 replace likely', '2 may follow', '1 added'])
      assert(head.includes(count), `The card's summary lacks "${count}": "${head}"`);
    assert(text('.infra-card-foot').includes('not from a terraform plan'), 'The card did not say it is read from the code');
    await wait(() => document.querySelector('.infra-card-thumb svg'), 'The card has no thumbnail of the diagram');
    assert(tabs().some(t => t.startsWith('Infra')), `No Infra tab: ${tabs()}`);
    document.querySelector('.infra-card-head .link-button').click();
  });

  await page.evaluate(async () => {
    const { wait, assert, text, rows } = check;
    await wait(() => document.querySelector('.infra-tab .relation-map svg'), 'The Infra tab did not draw its diagram');
    assert(location.hash === '#infra', `The card opened ${location.hash}`);
    assert(text('.infra-source').includes('No terraform plan is attached'), 'The tab did not say no plan is attached');

    // Riskiest first, and every reading of a destroy or a replace says where it comes from.
    const list = rows();
    assert(list[0].name.includes('azurerm_storage_table.audit') && list[0].badges.join() === 'destroy likely,from code', `First row: ${JSON.stringify(list[0])}`);
    assert(list[1].name.includes('azurerm_storage_account.uploads') && list[1].badges.join() === 'replace likely,from code', `Second row: ${JSON.stringify(list[1])}`);
    assert(/azurerm \d+\.\d+\.\d+ documentation says changing account_tier forces a new resource/.test(list[1].reason), `The replace gave no source: "${list[1].reason}"`);
    const app = list.find(r => r.name.includes('azurerm_linux_function_app.api'));
    assert(app?.badges.join() === 'may follow,changed,from code', `The function app: ${JSON.stringify(app)}`);
    const queue = list.find(r => r.name.includes('azurerm_storage_queue.resize'));
    assert(queue?.badges.join() === 'added', `A resource the pull request adds carried a risk: ${JSON.stringify(queue)}`);

    // The diagram draws the changed resources, and a click on one leads to its row.
    const drawn = [...document.querySelectorAll('.infra-tab .relation-node')].map(n => n.querySelector('title').textContent);
    // The values' changed words are marked, like a diff.
    const marks = [...document.querySelectorAll('.infra-attributes del, .infra-attributes ins')].map(m => `${m.tagName}:${m.textContent}`);
    assert(marks.includes('DEL:Standard') && marks.includes('INS:Premium'), `The tier's change is not marked: ${marks}`);
    assert(drawn.some(t => t.startsWith('azurerm_storage_account.uploads: replace likely')), `The replaced account is not drawn: ${drawn}`);
    assert(!drawn.some(t => t.startsWith('azurerm_resource_group.this')), 'An unrelated neighbour is drawn');
  });

  // Dragging the canvas moves the diagram, and the drag picks nothing, even when it starts on a card.
  const canvas = page.locator('.infra-tab .diagram-canvas');
  const card = await page.locator('.infra-tab .relation-node.tone-replace .relation-card').boundingBox();
  const before = await page.locator('.infra-tab .diagram-canvas-content').evaluate(c => c.style.transform);
  await page.mouse.move(card.x + 20, card.y + 10);
  await page.mouse.down();
  await page.mouse.move(card.x - 60, card.y + 40, { steps: 6 });
  await page.mouse.up();
  await page.evaluate(async before => {
    const { assert } = check;
    const after = document.querySelector('.infra-tab .diagram-canvas-content').style.transform;
    assert(after !== before, `Dragging did not move the diagram: ${after}`);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert(!document.querySelector('.infra-row.flash'), 'A drag that started on a card picked it');
  }, before);
  await canvas.locator('button', { hasText: 'Fit' }).click();

  await page.getByRole('button', { name: 'azurerm_storage_account.uploads: replace likely. Show it.' }).press('Enter');
  await page.evaluate(async () => {
    const { wait, assert, text } = check;
    const row = 'infra-0-azurerm_storage_account.uploads';
    await wait(() => document.querySelector('.infra-row.flash')?.id === row, 'Activating a box did not point at its row');
    assert(document.activeElement?.id === row, 'Activating a box did not move keyboard focus to its row');

    document.querySelector('.infra-source .link-button').click();
    await wait(() => document.querySelectorAll('.infra-source li').length > 0, 'How this works did not open');
    assert(text('.infra-source ul').includes("Files the pull request doesn't change aren't read"), 'The limits are not listed');
    assert(document.documentElement.scrollWidth <= innerWidth, 'The Infra tab scrolls sideways');
  });

  // A pull request without Terraform has neither the card nor the tab, and loads nothing for them.
  await page.goto('http://127.0.0.1:5173/test-dist/index.html?snapshot=demo-471#overview');
  return page.evaluate(async () => {
    const { wait, assert, tabs } = check;
    await wait(() => document.querySelector('.summary-groups'), 'The pull request without Terraform did not load');
    assert(!document.querySelector('.infra-card'), 'A pull request without Terraform shows the Infrastructure card');
    assert(!tabs().some(t => t.startsWith('Infra')), `A pull request without Terraform has an Infra tab: ${tabs()}`);
    const infraAssets = performance.getEntriesByType('resource').filter(r => /\/(?:InfraCard-|InfraDiagram-|InfraTab-|infra-|terraform-|tree-sitter-hcl)/.test(new URL(r.name).pathname));
    assert(infraAssets.length === 0, `Infra assets loaded for a pull request without Terraform: ${infraAssets.map(r => r.name)}`);
    return 'infra view: card, tab, risk order, sources, diagram keyboard activation, and no Infra download without Terraform checked';
  });
}
