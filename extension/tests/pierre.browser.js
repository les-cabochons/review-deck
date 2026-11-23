// Run through playwright-cli run-code --filename=extension/tests/pierre.browser.js.
// Uses only the local demo and its in-memory writes.
async page => {
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  try {
    await page.goto('http://127.0.0.1:5173/dev/?pr=17901&repo=t3code#files');
    const f = page.frameLocator('#frame');
    await f.locator('[data-renderer="pierre-diffs"]').first().waitFor();
    // Guided or Files A–Z is the Files toolbar's toggle. Its gear holds the diff view; the highlighted item is the
    // current one.
    const viewButton = name => f.locator('.files-toolbar').getByRole('button', { name, exact: true });
    const showView = name => viewButton(name).click();
    const gear = () => f.getByRole('button', { name: /^File view settings/ }).click();
    const isCurrent = item => item.evaluate(el => el.classList.contains('menu-item-selected'));
    const setting = async name => {
      await gear();
      const item = f.getByRole('menuitem', { name, exact: true });
      // Picking the current one changes nothing, so the menu just closes.
      if (await isCurrent(item)) await page.keyboard.press('Escape');
      else await item.click();
    };
    const checked = async name => {
      await gear();
      const on = await isCurrent(f.getByRole('menuitem', { name, exact: true }));
      await page.keyboard.press('Escape');
      return on;
    };
    await showView('Guided');
    await setting('Inline');
    await f.locator('diffs-container [data-column-number="22"]').first().waitFor();
    await f.locator('file-tree-container').first().waitFor();
    const firstTreeFile=f.locator('file-tree-container').first().getByRole('treeitem',{name:'ProviderSettingsForm.tsx',exact:true});
    await firstTreeFile.click();
    if(await firstTreeFile.getAttribute('aria-selected')!=='true')throw new Error('Pierre tree file selection failed');

    const first=f.locator('diffs-container').first();
    await first.locator('[data-column-number="22"][data-line-type="change-addition"]').click();
    const composer=f.getByRole('textbox',{name:'Comment on apps/web/src/components/settings/ProviderSettingsForm.tsx, right line 22',exact:true});
    await composer.fill('Pierre browser check: right-side comment.');
    await f.getByRole('button',{name:'Add single comment',exact:true}).click();
    await f.getByText('Pierre browser check: right-side comment.',{exact:true}).waitFor();

    await setting('Side-by-side');
    if (!(await checked('Side-by-side'))) throw new Error('Diff setting did not switch to side-by-side');
    const deletion=f.locator('diffs-container [data-column-number][data-line-type="change-deletion"]').first();
    const leftLine=await deletion.getAttribute('data-column-number');
    await deletion.click();
    const left=f.getByRole('textbox',{name:new RegExp('Comment on .*left line '+leftLine+'$')});
    await left.fill('Pierre browser check: pending left-side draft.');
    await f.getByRole('button',{name:'Start a review',exact:true}).click();
    await f.getByText('Pierre browser check: pending left-side draft.',{exact:true}).waitFor();
    await f.getByRole('button',{name:'Pending comment actions',exact:true}).click();
    await f.getByRole('menuitem',{name:'Edit',exact:true}).click();
    await f.getByRole('textbox',{name:'Edit pending comment',exact:true}).fill('Pierre browser check: edited draft.');
    await f.getByRole('button',{name:'Update comment',exact:true}).click();
    await f.getByText('Pierre browser check: edited draft.',{exact:true}).waitFor();

    await showView('Files A–Z');
    if ((await viewButton('Files A–Z').getAttribute('aria-pressed')) !== 'true') throw new Error('View toggle did not switch to A–Z');
    if(await f.locator('file-tree-container').count()!==1)throw new Error('Alphabetical view should have one Pierre tree');
    // Diffs mount lazily near the viewport, so jump to the commented file the way a reviewer would.
    await f.locator('file-tree-container').getByRole('treeitem',{name:'ProviderSettingsForm.tsx',exact:true}).click();
    await f.getByText('Pierre browser check: right-side comment.',{exact:true}).waitFor();
    await f.getByText('Pierre browser check: edited draft.',{exact:true}).waitFor();

    await f.getByRole('button',{name:'Pending comment actions',exact:true}).click();
    await f.getByRole('menuitem',{name:'Delete',exact:true}).click();
    await f.getByText('Pierre browser check: edited draft.',{exact:true}).waitFor({state:'hidden'});
    // The theme switch comes after the menu: repainting the diffs changes their heights, which scrolls the page and
    // closes any open menu.
    await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption('dark');
    await f.locator('diffs-container').first().locator('pre').first().waitFor();
    await page.waitForFunction(()=>{
      const doc=document.getElementById('frame').contentDocument;
      const pre=doc.querySelector('diffs-container')?.shadowRoot.querySelector('pre');
      const color=pre&&doc.defaultView.getComputedStyle(pre).backgroundColor.match(/[\d.]+/g)?.map(Number);
      return color&&color.slice(0,3).every(value=>value<128);
    });
    await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption('light');
    const hunks=await f.locator('.file-card').count();
    if(!hunks||await f.locator('diffs-container').count()>=hunks)throw new Error('Expected only diffs near the viewport to be mounted');
    await f.getByRole('tab',{name:'Overview',exact:true}).click();
    if(await f.locator('diffs-container').count()||await f.locator('file-tree-container').count())throw new Error('Pierre elements survived tab unmount');
    await f.getByRole('tab',{name:/^Files/}).click();
    await f.locator('diffs-container').first().waitFor();
    if(await f.locator('diffs-container').count()!==await f.locator('.pierre-diff').count())throw new Error('Diff elements duplicated after remount');
    if(errors.length)throw new Error(errors.join('\n'));
    return {pierreDiffs:true,pierreTrees:true,fileSelection:true,rightComment:true,leftDraft:true,draftEditDelete:true,splitAndAlphabetical:true,darkTheme:true,lazyMount:true,cleanRemount:true,errors};
  } finally {
    page.off('pageerror', onError);
  }
}
