// The browser keeps the redirect rules across restarts and updates. They're rebuilt from the saved links on install
// and on each update, in case the new version builds them differently. The options page rebuilds them on save, and
// this script when it learns a Deck from a page you open.
import { learnDeck, STORAGE_KEY } from "./decks";
import { applySavedLinks, savedLinks } from "./rules";

chrome.runtime.onInstalled.addListener(() => {
  applySavedLinks().catch((error) => console.error("[review-deck-links] could not rebuild the redirect rules:", error));
});

// Learns each organization's Deck the first time a tab shows it (Repos → Deck, or the Open in Review Deck menu), so
// nothing has to be pasted. The browser gives the URL only for pages within the host permissions, and on in-page
// navigations too, which is how Azure DevOps switches hubs. The URL comes with the event that changes it, and again
// from the tab when the page completes, in case this script was still starting when the URL changed. One learn at a
// time, so two organizations learned at once don't overwrite each other's saved line.
let learning = Promise.resolve();
chrome.tabs.onUpdated.addListener((_tabId, changed, tab) => {
  const url = changed.url ?? (changed.status === "complete" ? tab.url : undefined);
  if (!url) return;
  learning = learning.then(async () => {
    const next = learnDeck(await savedLinks(), url);
    if (next === null) return;
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    const decks = await applySavedLinks();
    console.info(`[review-deck-links] learned a Deck from ${url}. Decks: ${decks.map((d) => `${d.organization} (${d.hub})`).join(", ")}`);
  }).catch((error) => console.error(`[review-deck-links] could not learn the Deck of ${url}:`, error));
});
