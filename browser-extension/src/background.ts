// The browser keeps the redirect rules across restarts and updates. They're rebuilt from the saved links on install
// and on each update, in case the new version builds them differently. The options page rebuilds them on save.
import { applySavedLinks } from "./rules";

chrome.runtime.onInstalled.addListener(({ reason }) => {
  applySavedLinks()
    .then((decks) => {
      // Nothing redirects until a Deck is saved, so a new install opens the page that asks for one.
      if (reason === "install" && decks.length === 0) return chrome.runtime.openOptionsPage();
    })
    .catch((error) => console.error("[review-deck-links] could not rebuild the redirect rules:", error));
});
