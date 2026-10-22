// Run with playwright-cli run-code --filename=extension/tests/startup.browser.js.
// Tests the packaged entry point. Serve extension/ at port 5173 first.
async page => {
  const outcomes = [];
  const hostUrl = 'http://127.0.0.1:5173/startup-host';
  for (const scenario of ['empty', 'navigation-error']) {
    await page.route(hostUrl, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><body>
      <div id="state">Loading...</div><script>
      window.calls=[];
      window.addEventListener('message', event => {
        let m;try {m=JSON.parse(event.data);}catch{return;}
        if(!m.instanceId)return;
        window.calls.push(m.methodName);
        let result, error;
        if(m.methodName==='initialHandshake') result={
          context:{pageContext:{webContext:{project:{id:'test',name:'test'}}},
            extension:{publisherId:'test',extensionId:'review'},user:{id:'test',displayName:'Test',name:'test'},host:{name:'test'}},
          initialConfig:{},contributionId:'test.review.hub'};
        else if(m.methodName==='getService') {
          if('${scenario}'==='navigation-error') error={message:'Navigation unavailable'};
          else result={getQueryParams:{__proxyFunctionId:1},getHash:{__proxyFunctionId:2},onHashChanged:{__proxyFunctionId:3},setHash:{__proxyFunctionId:3},replaceHash:{__proxyFunctionId:3},setQueryParams:{__proxyFunctionId:3}};
        }
        else if(m.methodName==='proxy1') result={};
        else if(m.methodName==='proxy2') result='';
        else if(m.methodName==='proxy3') result=null;
        else if(m.methodName==='notifyLoadSucceeded'||m.methodName==='notifyLoadFailed') document.getElementById('state').textContent=m.methodName;
        event.source.postMessage(JSON.stringify({id:m.id,result,error,handshakeToken:m.handshakeToken}),event.origin);
      });
      </script><iframe src="http://127.0.0.1:5173/dist/review.html"></iframe></body>` }));
    const started = Date.now();
    try {
      await page.goto(hostUrl);
      const frame = page.frameLocator('iframe');
      await frame.getByRole('heading', {name: scenario==='empty' ? 'Open a pull request to review' : 'Could not open the review'}).waitFor();
      const expected = scenario==='empty' ? 'notifyLoadSucceeded' : 'notifyLoadFailed';
      await page.waitForFunction(state => document.getElementById('state').textContent===state, expected);
      if (scenario==='navigation-error' && !(await frame.locator('body').innerText()).includes('Navigation unavailable')) throw new Error('Serialized navigation error message was lost');
      if (scenario==='empty') {
        if (await frame.getByRole('link',{name:'Open Azure Repos'}).getAttribute('target')!=='_top') throw new Error('Repository link would navigate only the iframe');
        const requests=await frame.locator('body').evaluate(()=>performance.getEntriesByType('resource').map(r=>r.name));
        if (requests.some(url=>/\/(page-|engine-)|\.wasm/.test(url))) throw new Error('Empty hub downloaded the review UI or analysis engine');
      }
      outcomes.push({scenario, hostFinished:true, elapsedMs:Date.now()-started});
    } finally {
      await page.unroute(hostUrl);
    }
  }

  await page.addInitScript(() => Object.defineProperty(window,'localStorage',{
    get(){throw new DOMException('Storage access denied','SecurityError');},
  }));
  await page.goto('http://127.0.0.1:5173/dist/review.html?mock=t3code-17901');
  await page.getByRole('tab',{name:'Overview',exact:true}).waitFor();
  await page.getByRole('tab',{name:/Files/}).click();
  await page.locator('.files-content').waitFor();
  const toggles=page.locator('.files-toolbar .mode-toggle');
  await toggles.nth(1).locator('button').first().click();
  await page.locator('.diff-split').first().waitFor();
  await page.getByRole('button',{name:'File view',exact:true}).click();
  await page.getByRole('menuitem',{name:'Files A–Z'}).click();
  if ((await toggles.nth(0).locator('button').first().innerText()).trim()!=='Files A–Z') throw new Error('File view did not change with blocked storage');
  if (await page.locator('.error-box').count()) throw new Error(await page.locator('.error-box').first().innerText());
  const styled=await page.locator('.files-layout').evaluate(node=>getComputedStyle(node).display);
  if (!['grid','flex'].includes(styled)) throw new Error('Packaged stylesheet did not load');
  outcomes.push({scenario:'blocked-storage', overview:true, semanticDiff:true, splitDiff:true, alphabetical:true, styled:true});
  return outcomes;
}
