/**
 * Which Azure DevOps organizations have a Deck, and the redirect rules that send their pull request links to it.
 * No browser API here, so the options page, the background script and the tests share it.
 */

/** An Azure DevOps organization with Review Deck installed, and the id of its Deck hub. */
export interface Deck {
  /** As in `dev.azure.com/<organization>`, lowercase. */
  organization: string;
  /**
   * The Deck hub's contribution id, `<publisher>.<extension>.review-hub`. A private copy of Review Deck has its own
   * publisher, so this comes from the pasted link instead of being fixed here.
   */
  hub: string;
}

/** The options page's text, in the extension's local storage: links to Deck pages, one per line, pasted or learned. */
export const STORAGE_KEY = "deckLinks";

/**
 * Pages whose links to a pull request keep opening the classic page: Azure DevOps on both of its domains, and the
 * Deck's own frame, served from `<publisher>.gallerycdn.vsassets.io`, for its "open in Azure DevOps" link. A domain
 * also covers its subdomains.
 */
export const AZURE_DEVOPS_DOMAINS = ["dev.azure.com", "visualstudio.com", "vsassets.io"];

/** Azure DevOps allows letters, digits and hyphens in organization names. Checked so a name is safe in a regex. */
const ORGANIZATION = /^[a-z0-9][a-z0-9-]*$/i;
const HUB = /^[a-z0-9-]+\.[a-z0-9-]+\.review-hub$/i;

/**
 * The Deck in a link to its page, as the address bar shows it on Repos → Deck:
 * `https://dev.azure.com/<organization>/<project>/_apps/hub/<publisher>.review-deck.review-hub`, or the same page on
 * `<organization>.visualstudio.com`. Null for any other link.
 */
export function deckFromLink(link: string): Deck | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  let organization: string | undefined;
  if (host === "dev.azure.com") organization = segments.shift();
  else if (host.endsWith(".visualstudio.com")) organization = host.slice(0, -".visualstudio.com".length);
  const apps = segments.indexOf("_apps");
  const hub = apps >= 0 && segments[apps + 1] === "hub" ? segments[apps + 2] : undefined;
  if (!organization || !ORGANIZATION.test(organization) || !hub || !HUB.test(hub)) return null;
  return { organization: organization.toLowerCase(), hub };
}

/**
 * The Decks in the options page's text, one link per line, and the lines that aren't a link to a Deck page. Blank
 * lines are skipped. A later line for the same organization replaces an earlier one.
 */
export function parseDecks(text: string): { decks: Deck[]; invalid: string[] } {
  const byOrganization = new Map<string, Deck>();
  const invalid: string[] = [];
  for (const line of text.split("\n").map((l) => l.trim())) {
    if (!line) continue;
    const deck = deckFromLink(line);
    if (deck) byOrganization.set(deck.organization, deck);
    else invalid.push(line);
  }
  return { decks: [...byOrganization.values()], invalid };
}

/** The Deck hub of Review Deck itself. A private copy has its own publisher but keeps the extension id. */
const REVIEW_DECK_HUB = /\.review-deck\.review-hub$/i;

/**
 * The saved text with the Deck of the page at `link` added, so the extension learns each organization's Deck from the
 * pages you open instead of asking for it. Null when `link` isn't a Review Deck page, or its organization is already
 * saved with that hub. The link replaces the organization's earlier lines, without its query and hash.
 */
export function learnDeck(text: string, link: string): string | null {
  const deck = deckFromLink(link);
  if (!deck || !REVIEW_DECK_HUB.test(deck.hub)) return null;
  if (parseDecks(text).decks.some((d) => d.organization === deck.organization && d.hub === deck.hub)) return null;
  const url = new URL(link.trim());
  const kept = text.split("\n").filter((line) => line.trim() !== "" && deckFromLink(line)?.organization !== deck.organization);
  return [...kept, `${url.origin}${url.pathname}`].join("\n");
}

/**
 * The organization's pull request pages, matched whole: `\1` is the project and `\2` the pull request id. Each must
 * match the whole URL because Chrome replaces only the matched part with the substitution, and Firefox the whole
 * URL. A partial match would keep the rest of the URL (its query) in Chrome only. One pattern per domain: Chrome
 * refuses a regex over 2 KB once compiled, and the two domains in one alternation went over.
 */
export function prLinkPatterns(organization: string): string[] {
  if (!ORGANIZATION.test(organization)) throw new Error(`Not an Azure DevOps organization name: ${organization}`);
  const page = "/([^/?#]+)/_git/[^/?#]+/pullrequest/([0-9]+)(?:[/?#].*)?$";
  return [`^https://dev\\.azure\\.com/${organization}${page}`, `^https://${organization}\\.visualstudio\\.com(?:/DefaultCollection)?${page}`];
}

/**
 * Redirect rules for each Deck: a pull request page of its organization, opened from anywhere but Azure DevOps (chat,
 * email, another site, the address bar), opens in the Deck instead. The link has the repository's name, not its id,
 * so the Deck finds the repository from the pull request id (extension/src/app/hashRoute.ts prWithoutRepo).
 */
export function redirectRules(decks: Deck[]): chrome.declarativeNetRequest.Rule[] {
  return decks
    .flatMap((deck) => prLinkPatterns(deck.organization).map((regexFilter) => ({ deck, regexFilter })))
    .map(({ deck, regexFilter }, i) => ({
      id: i + 1,
      priority: 1,
      action: {
        type: "redirect",
        redirect: { regexSubstitution: `https://dev.azure.com/${deck.organization}/\\1/_apps/hub/${deck.hub}?pr=\\2` },
      },
      condition: {
        regexFilter,
        isUrlFilterCaseSensitive: false,
        resourceTypes: ["main_frame"],
        excludedInitiatorDomains: AZURE_DEVOPS_DOMAINS,
      },
    }));
}
