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
    const pathOf = input => input.closest("article").querySelector(".file-path").title;
    const path = pathOf(fileCheckbox);
    // Viewed is per chunk, so follow this card, not the file's other cards.
    const cardId = fileCheckbox.closest("article").id;
    const hunkId = cardId.slice("hunk-".length);
    const fileInput = () => doc.getElementById(cardId)?.querySelector(".viewed-control input");
    if (groupCheckbox.checked || groupCheckbox.indeterminate) groupCheckbox.click();
    if (groupCheckbox.checked) groupCheckbox.click();
    await tick();
    const before = progress();
    fileInput().click();
    await wait(() => fileInput().checked, "Chunk was not marked viewed");
    assert(groupCheckbox.indeterminate && groupCheckbox.getAttribute("aria-checked") === "mixed", "Concern did not show mixed state");
    assert([...group.querySelectorAll(".hunk-card .viewed-control input")].filter(input => pathOf(input) === path && input !== fileInput())
      .every(input => !input.checked), "Ticking one chunk ticked the file's other chunks");
    const selectedTree = trees()[0];
    const folder = selectedTree.shadowRoot.querySelector('[data-item-type="folder"][aria-expanded="true"]');
    if (folder) folder.click();
    groupCheckbox.click();
    await wait(() => groupCheckbox.checked && !groupCheckbox.indeterminate, "Concern checkbox did not mark all files");
    await wait(() => indicators().some(indicator => indicator.textContent.includes("✓")), "Grouped tree did not show a Viewed check");
    assert(trees()[0] === selectedTree, "Viewed update recreated the file tree");
    if (folder) assert(folder.getAttribute("aria-expanded") === "false", "Viewed update reset folder expansion");
    groupCheckbox.click();
    await wait(() => !groupCheckbox.checked && !groupCheckbox.indeterminate, "Concern checkbox did not unmark files");
    assert(!group.querySelector("button.pierre-hunk-header"), "Chunks still fold on their own");
    // Ticking Viewed folds the card, like GitHub. Unticking the concern reopened it, so its cards remount first.
    await wait(() => fileInput(), "Concern did not reopen when unmarked");
    fileInput().click();
    const folded = () => doc.getElementById(cardId).querySelector("button.file-collapse").getAttribute("aria-expanded") === "false";
    await wait(() => folded() && !doc.getElementById(cardId).querySelector(".pierre-hunk-header"), "Viewed chunk did not fold");
    await view("Files A–Z");
    const card = doc.getElementById(`file-${path}`);
    card.scrollIntoView({ block: "start" });
    await wait(() => card.querySelector(".viewed-control input"), "Alphabetical file did not mount");
    // A–Z shows the whole file. It is viewed and folded once every chunk is, and mixed and open before that.
    const alphaBox = card.querySelector(".viewed-control input");
    const whole = alphaBox.checked;
    assert(whole || alphaBox.indeterminate, "Viewed state did not follow into alphabetical view");
    assert(progress() === before + (whole ? 1 : 0), "Progress counted a file before all its chunks were viewed");
    assert(!doc.querySelector(".group-chip"), "Repeated group chips remain");
    const alphaFold = card.querySelector("button.file-collapse");
    assert((alphaFold.getAttribute("aria-expanded") === "false") === whole, "File fold did not follow into alphabetical view");
    if (whole) {
      alphaFold.click();
      await wait(() => card.querySelector(".pierre-hunk-header"), "Alphabetical file did not unfold");
    }
    alphaFold.click();
    await wait(() => !card.querySelector(".pierre-hunk-header"), "Alphabetical file did not fold");
    toggle(1).click();
    await tick();
    assert(card.querySelector("button.file-collapse").getAttribute("aria-expanded") === "false", "Diff mode reset the file fold");
    toggle(1).click();
    // The A–Z checkbox marks every chunk of the file, which completes it.
    if (!whole) {
      card.querySelector(".viewed-control input").click();
      await wait(() => card.querySelector(".viewed-control input").checked && progress() === before + 1, "A–Z Viewed did not mark every chunk");
    }
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
    assert(viewedKey && Object.hasOwn(JSON.parse(win.localStorage.getItem(viewedKey)), hunkId), "Viewed chunk was not persisted locally");
    await view("Guided");
    return { groupedAndAlphabetical: true, inlineAndSplit: true, perChunkViewedState: true, mixedGroupCheckbox: true,
      treeCheck: true, treeExpansionPreserved: true, collapsePreserved: true, mergedCounterAligned: true,
      searchKeepsTotal: true, localPersistence: true, viewedKey, hunkId, wholeFileViewed: whole, progress: progress() };
});
}
