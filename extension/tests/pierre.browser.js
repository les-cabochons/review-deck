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
    // View toggles name the current mode, like Azure DevOps' "Inline ▾": one click flips them.
    const viewToggle = f.locator('.files-toolbar .mode-toggle').nth(0).locator('button').first();
    const diffToggle = f.locator('.files-toolbar .mode-toggle').nth(1).locator('button').first();
    const label = async (toggle) => (await toggle.innerText()).trim();
    if (await label(viewToggle) !== 'By concern') await viewToggle.click();
    if (await label(diffToggle) !== 'Inline') await diffToggle.click();
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

    await diffToggle.click();
    if (await label(diffToggle) !== 'Side-by-side') throw new Error('Diff toggle did not switch to side-by-side');
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

    await viewToggle.click();
    if (await label(viewToggle) !== 'Files A–Z') throw new Error('View toggle did not switch to A–Z');
    if(await f.locator('file-tree-container').count()!==1)throw new Error('Alphabetical view should have one Pierre tree');
    // Diffs mount lazily near the viewport, so jump to the commented file the way a reviewer would.
    await f.locator('file-tree-container').getByRole('treeitem',{name:'ProviderSettingsForm.tsx',exact:true}).click();
    await f.getByText('Pierre browser check: right-side comment.',{exact:true}).waitFor();
    await f.getByText('Pierre browser check: edited draft.',{exact:true}).waitFor();

    await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption('dark');
    await f.locator('diffs-container').first().locator('pre').first().waitFor();
    await page.waitForFunction(()=>{
      const doc=document.getElementById('frame').contentDocument;
      const pre=doc.querySelector('diffs-container')?.shadowRoot.querySelector('pre');
      const color=pre&&doc.defaultView.getComputedStyle(pre).backgroundColor.match(/[\d.]+/g)?.map(Number);
      return color&&color.slice(0,3).every(value=>value<128);
    });
    await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption('light');

    await f.getByRole('button',{name:'Pending comment actions',exact:true}).click();
    await f.getByRole('menuitem',{name:'Delete',exact:true}).click();
    await f.getByText('Pierre browser check: edited draft.',{exact:true}).waitFor({state:'hidden'});
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
