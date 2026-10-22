// Run through playwright-cli run-code --filename=extension/tests/review-controls.browser.js.
// Uses only the local mock and this browser profile's viewed state.
async page => {
  await page.goto('http://127.0.0.1:5173/dev/?pr=17901&repo=t3code#files');
  await page.frameLocator('#frame').locator('.analyzing-note').waitFor({ state: 'detached', timeout: 60000 });
  return page.evaluate(async () => {
    const frame = document.querySelector("#frame");
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const wait = async (condition, message) => {
      for (let i = 0; i < 100; i++) {
        if (condition()) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error(message);
    };
    const tick = () => new Promise(resolve => setTimeout(resolve, 100));
    const toggle = index => doc.querySelectorAll(".files-toolbar .mode-toggle")[index].querySelector("button");
    const view = async label => {
      if (toggle(0).textContent.trim() !== label) toggle(0).click();
      await wait(() => toggle(0).textContent.trim() === label, "File view did not switch");
      await tick();
    };
    const progress = () => Number(doc.querySelector(".viewed-progress").textContent.split("/")[0].trim());
    const trees = () => [...doc.querySelectorAll("file-tree-container")];
    const indicators = () => trees().flatMap(tree => [...tree.shadowRoot.querySelectorAll('[title^="Viewed,"]')]);
    await wait(() => doc.querySelector(".files-toolbar .mode-toggle"), "Files toolbar did not load");
    await view("Guided");
    await wait(() => doc.querySelector(".group-header-row"), "Grouping did not finish");
    await wait(() => doc.querySelector(".hunk-card .viewed-control input"), "Grouped file checkbox did not mount");
    // A concern with several files, so ticking one leaves it mixed.
    const group = [...doc.querySelectorAll(".group-section")].find(section => section.querySelector(".group-header")?.getAttribute("aria-expanded") === "true"
      && /([2-9]|\d{2,}) files/.test(section.querySelector(".group-header .count")?.textContent ?? ""));
    group.scrollIntoView({ block: "start" });
    await wait(() => group.querySelector(".hunk-card .viewed-control input"), "Chosen concern's cards did not mount");
    const groupCheckbox = group.querySelector(".group-header-row input");
    const fileCheckbox = group.querySelector(".hunk-card .viewed-control input");
    const label = fileCheckbox.getAttribute("aria-label");
    const path = label.slice(5, -10);
    const fileInput = () => [...doc.querySelectorAll(".hunk-card .viewed-control input, .file-card .viewed-control input")]
      .find(input => input.getAttribute("aria-label") === label);
    if (groupCheckbox.checked || groupCheckbox.indeterminate) groupCheckbox.click();
    if (groupCheckbox.checked) groupCheckbox.click();
    await tick();
    const before = progress();
    fileInput().click();
    await wait(() => progress() === before + 1, "Shared file progress was not counted once");
    assert(groupCheckbox.indeterminate && groupCheckbox.getAttribute("aria-checked") === "mixed", "Concern did not show mixed state");
    assert([...group.querySelectorAll(".hunk-card .viewed-control input")].filter(input => input.getAttribute("aria-label") === label)
      .every(input => input.checked), "Repeated file headers disagreed on Viewed state");
    await wait(() => indicators().some(indicator => indicator.textContent.includes("✓")), "Grouped tree did not show a Viewed check");
    const selectedTree = trees()[0];
    const folder = selectedTree.shadowRoot.querySelector('[data-item-type="folder"][aria-expanded="true"]');
    if (folder) folder.click();
    groupCheckbox.click();
    await wait(() => groupCheckbox.checked && !groupCheckbox.indeterminate, "Concern checkbox did not mark all files");
    assert(trees()[0] === selectedTree, "Viewed update recreated the file tree");
    if (folder) assert(folder.getAttribute("aria-expanded") === "false", "Viewed update reset folder expansion");
    groupCheckbox.click();
    await wait(() => !groupCheckbox.checked && !groupCheckbox.indeterminate, "Concern checkbox did not unmark files");
    assert(!group.querySelector("button.pierre-hunk-header"), "Chunks still fold on their own");
    // Ticking Viewed folds the file, like GitHub. Unticking the concern reopened it, so its cards remount first.
    await wait(() => fileInput(), "Concern did not reopen when unmarked");
    fileInput().click();
    const folded = () => [...group.querySelectorAll("button.file-collapse")].find(button => button.getAttribute("aria-label") === `Expand ${path}`);
    await wait(() => folded() && !folded().closest("article").querySelector(".pierre-hunk-header"), "Viewed file did not fold");
    await view("Files A–Z");
    const card = doc.getElementById(`file-${path}`);
    card.scrollIntoView({ block: "start" });
    await wait(() => card.querySelector(".viewed-control input"), "Alphabetical file did not mount");
    assert(card.querySelector(".viewed-control input").checked, "Viewed state did not follow into alphabetical view");
    assert(!doc.querySelector(".group-chip"), "Repeated group chips remain");
    const alphaFold = card.querySelector("button.file-collapse");
    assert(alphaFold.getAttribute("aria-expanded") === "false" && !card.querySelector(".pierre-hunk-header"), "File fold did not follow into alphabetical view");
    alphaFold.click();
    await wait(() => card.querySelector(".pierre-hunk-header"), "Alphabetical file did not unfold");
    alphaFold.click();
    await wait(() => !card.querySelector(".pierre-hunk-header"), "Alphabetical file did not fold");
    toggle(1).click();
    await tick();
    assert(card.querySelector("button.file-collapse").getAttribute("aria-expanded") === "false", "Diff mode reset the file fold");
    toggle(1).click();
    await wait(() => indicators().some(indicator => indicator.textContent.includes("✓")), "Alphabetical tree did not show a Viewed check");
    const stats = doc.querySelector(".files-toolbar .stats");
    assert(doc.querySelectorAll(".files-toolbar .stats").length === 1 && !stats.textContent.includes("files"), "File counters were not merged");
    const center = element => { const rect = element.getBoundingClientRect(); return rect.y + rect.height / 2; };
    const centers = [".viewed-progress", ".adds", ".dels"].map(selector => center(stats.querySelector(selector)));
    assert(Math.max(...centers) - Math.min(...centers) <= 1, "Toolbar counts are not vertically aligned");
    const filter = doc.querySelector('[aria-label="Search files"]');
    const originalProgress = doc.querySelector(".viewed-progress").textContent;
    const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value").set;
    setter.call(filter, "does-not-exist");
    filter.dispatchEvent(new win.Event("input", { bubbles: true }));
    await tick();
    assert(doc.querySelector(".viewed-progress").textContent === originalProgress, "Tree search changed the total file count");
    setter.call(filter, "");
    filter.dispatchEvent(new win.Event("input", { bubbles: true }));
    const viewedKey = Object.keys(win.localStorage).find(key => key.startsWith("semantic-review.viewed.") && key.endsWith(".0.2"));
    assert(viewedKey && Object.hasOwn(JSON.parse(win.localStorage.getItem(viewedKey)), path), "Viewed file was not persisted locally");
    await view("Guided");
    return { groupedAndAlphabetical: true, inlineAndSplit: true, sharedViewedState: true, mixedGroupCheckbox: true,
      treeCheck: true, treeExpansionPreserved: true, collapsePreserved: true, mergedCounterAligned: true,
      searchKeepsTotal: true, localPersistence: true, viewedKey, path, progress: progress() };
});
}
