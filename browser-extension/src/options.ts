// The toolbar popup and the extension's options page (the same page): the links to each organization's Deck.
import { type Deck, parseDecks, STORAGE_KEY } from "./decks";
import { applySavedLinks, savedLinks } from "./rules";

const links = document.getElementById("links") as HTMLTextAreaElement;
const save = document.getElementById("save") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLParagraphElement;

function show(decks: Deck[], invalid: string[]): void {
  const lines = [
    decks.length > 0
      ? `Pull request links of ${decks.map((d) => d.organization).join(", ")} open in the Deck.`
      : "No Deck yet: open Repos → Deck once in an organization, and its pull request links open in the Deck.",
  ];
  if (invalid.length > 0) lines.push(`Not a link to a Deck page, skipped: ${invalid.join(", ")}`);
  status.textContent = lines.join("\n");
}

save.addEventListener("click", async () => {
  save.disabled = true;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: links.value });
    const decks = await applySavedLinks();
    show(decks, parseDecks(links.value).invalid);
  } catch (error) {
    status.textContent = `Could not save: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    save.disabled = false;
  }
});

void savedLinks().then((text) => {
  links.value = text;
  const { decks, invalid } = parseDecks(text);
  show(decks, invalid);
});
