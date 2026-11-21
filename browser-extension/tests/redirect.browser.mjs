// Checks the redirect in a real Chromium with the built extension: which ways of opening a pull request link open the
// Deck, and which keep the classic page. Azure DevOps, the Deck's frame and a chat site are stub pages served by
// Playwright, so it needs no network and no Azure DevOps organization.
//   npm run browser:build
//   node browser-extension/tests/redirect.browser.mjs [--chrome <path to Chrome for Testing or Chromium>]
// Branded Google Chrome ignores --load-extension since version 137, so use Playwright's Chrome for Testing (the default)
// or a Chromium build.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");
const chromeAt = process.argv.indexOf("--chrome");
const executablePath = chromeAt > 0 ? process.argv[chromeAt + 1] : undefined;

const DECK_LINK = "https://dev.azure.com/cabochons/review-deck/_apps/hub/Cabochonio.review-deck.review-hub";
const PR = "https://dev.azure.com/cabochons/review-deck/_git/review-deck/pullrequest/69";
const DECK = `${DECK_LINK}?pr=69`;
const ADO_PAGE = "https://dev.azure.com/cabochons/review-deck/_git/review-deck/pullrequests";
const DECK_FRAME = "https://cabochonio.gallerycdn.vsassets.io/extensions/cabochonio/review-deck/dist/review.html";
const CHAT_PAGE = "https://chat.example/channel";

const links = `<a id="same" href="${PR}">same tab</a> <a id="new" href="${PR}" target="_blank">new tab</a>`;
const pages = new Map([
  [ADO_PAGE, `<title>ado</title>${links}<iframe src="${DECK_FRAME}"></iframe>`],
  [DECK_FRAME, `<a id="top" href="${PR}" target="_top">open in Azure DevOps</a>`],
  [CHAT_PAGE, `<title>chat</title>${links}`],
]);

const userDataDir = mkdtempSync(join(tmpdir(), "review-deck-links-"));
const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath,
  headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
const failures = [];
try {
  // Every https page is a stub: a pull request page says "classic", a Deck page "deck".
  await context.route(/^https:\/\//, (route) => {
    const url = route.request().url();
    const body = pages.get(url) ?? (url.includes("/_apps/hub/") ? "<title>deck</title>" : url.includes("/pullrequest/") ? "<title>classic</title>" : null);
    return body ? route.fulfill({ contentType: "text/html", body }) : route.abort();
  });

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const options = await context.newPage();
  await options.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
  // A second organization with the longest name Azure DevOps allows (50 characters): Chrome refuses a rule whose
  // regex compiles over 2 KB, and the save then reports the error instead.
  const longest = "x".repeat(50);
  await options.fill("#links", `${DECK_LINK}\n${DECK_LINK.replace("cabochons", longest)}`);
  await options.click("#save");
  await options.waitForFunction(() => document.getElementById("status").textContent.startsWith("Could not") || document.getElementById("status").textContent.includes(","));
  const saved = await options.textContent("#status");
  if (saved !== `Pull request links of cabochons, ${longest} open in the Deck.`) throw new Error(`The save failed: ${saved}`);

  /** Opens a page, runs `act` on it, and checks where the pull request link landed. */
  async function check(name, expected, act) {
    const page = await context.newPage();
    let landed;
    try {
      landed = await act(page);
    } catch (error) {
      landed = `error: ${error.message.split("\n")[0]}`;
    }
    const ok = landed === expected;
    if (!ok) failures.push(name);
    console.log(`${ok ? "ok  " : "FAIL"} ${name}\n     ${landed}`);
    await page.close();
  }

  /** Clicks `selector` on `page` (in `frame` if given) and resolves to the URL the pull request link landed on. */
  async function click(page, selector, frame) {
    const target = frame ? page.frameLocator(frame) : page;
    if ((await target.locator(selector).getAttribute("target")) === "_blank") {
      const [opened] = await Promise.all([context.waitForEvent("page"), target.locator(selector).click()]);
      await opened.waitForLoadState();
      const url = opened.url();
      await opened.close();
      return url;
    }
    const from = page.url();
    await Promise.all([page.waitForURL((url) => url.href !== from), target.locator(selector).click()]);
    return page.url();
  }

  await check("address bar or another app (no initiator) → Deck", DECK, async (page) => {
    await page.goto(PR);
    return page.url();
  });
  await check("chat site, same tab → Deck", DECK, async (page) => {
    await page.goto(CHAT_PAGE);
    return click(page, "#same");
  });
  await check("chat site, new tab → Deck", DECK, async (page) => {
    await page.goto(CHAT_PAGE);
    return click(page, "#new");
  });
  await check("Azure DevOps page, same tab → classic", PR, async (page) => {
    await page.goto(ADO_PAGE);
    return click(page, "#same");
  });
  await check("Azure DevOps page, new tab → classic", PR, async (page) => {
    await page.goto(ADO_PAGE);
    return click(page, "#new");
  });
  await check("Deck frame's link to the classic page → classic", PR, async (page) => {
    await page.goto(ADO_PAGE);
    return click(page, "#top", "iframe");
  });
  await check("reload of a classic page opened from Azure DevOps → classic", PR, async (page) => {
    await page.goto(ADO_PAGE);
    await click(page, "#same");
    await page.reload();
    return page.url();
  });
} finally {
  await context.close();
  rmSync(userDataDir, { recursive: true, force: true });
}
if (failures.length > 0) {
  console.error(`${failures.length} failed`);
  process.exit(1);
}
