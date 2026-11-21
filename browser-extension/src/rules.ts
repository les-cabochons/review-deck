import { type Deck, parseDecks, redirectRules, STORAGE_KEY } from "./decks";

/** The saved text of the options page: links to Deck pages, one per line. */
export async function savedLinks(): Promise<string> {
  const saved = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
  return typeof saved === "string" ? saved : "";
}

/**
 * Replaces every redirect rule with the ones for the saved Deck links, and resolves to those Decks. The saved text is
 * the only source: the rules are rebuilt from it whole, so running this twice, or from two places, ends the same.
 */
export async function applySavedLinks(): Promise<Deck[]> {
  const { decks } = parseDecks(await savedLinks());
  const current = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: current.map((rule) => rule.id),
    addRules: redirectRules(decks),
  });
  return decks;
}
