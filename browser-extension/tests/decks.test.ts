import assert from "node:assert/strict";
import { test } from "node:test";
import { deckFromLink, learnDeck, parseDecks, redirectRules } from "../src/decks";

type Rule = chrome.declarativeNetRequest.Rule;

/** What Chrome does with a redirect rule's regexSubstitution: it replaces the first match in the URL. */
function chromeRedirect(rule: Rule, url: string): string | null {
  const pattern = new RegExp(rule.condition.regexFilter!, "i");
  if (!pattern.test(url)) return null;
  return url.replace(pattern, rule.action.redirect!.regexSubstitution!.replace(/\\(\d)/g, "$$$1"));
}

/** What Firefox does (ExtensionDNR.sys.mjs applyRegexSubstitution): the substitution with its captures replaces the whole URL. */
function firefoxRedirect(rule: Rule, url: string): string | null {
  const match = new RegExp(rule.condition.regexFilter!, "i").exec(url);
  if (!match) return null;
  return rule.action.redirect!.regexSubstitution!.replace(/\\(.)/g, (_, c: string) => (c === "\\" ? c : (match[Number(c)] ?? "")));
}

/** Where both browsers send `url`, or null when neither redirects it. Fails if they disagree. */
function redirect(rules: Rule[], url: string): string | null {
  for (const rule of rules) {
    const chrome = chromeRedirect(rule, url);
    assert.equal(chrome, firefoxRedirect(rule, url), `Chrome and Firefox disagree on ${url}`);
    if (chrome) return chrome;
  }
  return null;
}

const deckLink = "https://dev.azure.com/cabochons/review-deck/_apps/hub/Cabochonio.review-deck.review-hub";
const privateCopyLink = "https://dev.azure.com/nventive/DevOps/_apps/hub/WepointCanada.review-deck.review-hub#pr=12&repo=abc";

test("Given a link to a Deck page, then its organization and hub are read from it", () => {
  assert.deepEqual(deckFromLink(deckLink), { organization: "cabochons", hub: "Cabochonio.review-deck.review-hub" });
  assert.deepEqual(deckFromLink(` ${privateCopyLink} `), { organization: "nventive", hub: "WepointCanada.review-deck.review-hub" });
  assert.deepEqual(deckFromLink("https://Cabochons.visualstudio.com/review-deck/_apps/hub/Cabochonio.review-deck.review-hub"), {
    organization: "cabochons",
    hub: "Cabochonio.review-deck.review-hub",
  });
});

test("Given a link to anything but a Deck page, then it isn't a Deck", () => {
  for (const link of [
    "https://dev.azure.com/cabochons/review-deck/_git/review-deck/pullrequest/12",
    "https://dev.azure.com/cabochons/review-deck/_apps/hub/Cabochonio.review-deck.changelog-hub",
    "http://dev.azure.com/cabochons/review-deck/_apps/hub/Cabochonio.review-deck.review-hub",
    "https://example.com/cabochons/review-deck/_apps/hub/Cabochonio.review-deck.review-hub",
    "https://dev.azure.com/(.*)/p/_apps/hub/Cabochonio.review-deck.review-hub",
    "cabochons",
  ]) {
    assert.equal(deckFromLink(link), null, link);
  }
});

test("Given the options page's text, then each line is a Deck or reported, and a later line replaces an organization's", () => {
  const { decks, invalid } = parseDecks(`${deckLink}\n\n  nventive  \n${privateCopyLink}\n${deckLink.replace("Cabochonio", "Other")}\n`);
  assert.deepEqual(decks, [
    { organization: "cabochons", hub: "Other.review-deck.review-hub" },
    { organization: "nventive", hub: "WepointCanada.review-deck.review-hub" },
  ]);
  assert.deepEqual(invalid, ["nventive"]);
});

test("Given a Deck page you open, then its organization is learned once, for all its projects", () => {
  // A first organization: its link is saved without the route.
  const learned = learnDeck("", `${privateCopyLink.replace("#pr=12&repo=abc", "")}?pr=12`);
  assert.equal(learned, "https://dev.azure.com/nventive/DevOps/_apps/hub/WepointCanada.review-deck.review-hub");
  // The same organization again, from another project: nothing to change, so the rules aren't rebuilt on each page.
  assert.equal(learnDeck(learned!, "https://dev.azure.com/nventive/Support/_apps/hub/WepointCanada.review-deck.review-hub"), null);
  // A second organization is added. A lone word the user typed stays, to be reported as before.
  assert.equal(learnDeck(`${learned}\nnotes`, deckLink), `${learned}\nnotes\n${deckLink}`);
  // The organization's Deck moved to another publisher: the new link replaces the old one.
  const moved = deckLink.replace("Cabochonio", "Other");
  assert.equal(learnDeck(`${deckLink}\n${learned}`, moved), `${learned}\n${moved}`);
});

test("Given a page that isn't Review Deck's own Deck, then nothing is learned", () => {
  for (const link of [
    "https://dev.azure.com/cabochons/review-deck/_git/review-deck/pullrequest/12",
    "https://dev.azure.com/cabochons/review-deck/_apps/hub/Cabochonio.review-deck.changelog-hub",
    // Another extension's hub named review-hub: pasting it is the user's choice, but browsing to it teaches nothing.
    "https://dev.azure.com/cabochons/review-deck/_apps/hub/SomeVendor.code-review.review-hub",
    "about:blank",
  ]) {
    assert.equal(learnDeck("", link), null, link);
  }
});

test("Given a pull request link of a saved organization, then both browsers open its project's Deck with the PR id", () => {
  const rules = redirectRules(parseDecks(`${deckLink}\n${privateCopyLink}`).decks);
  const deck = "https://dev.azure.com/cabochons/review-deck/_apps/hub/Cabochonio.review-deck.review-hub?pr=69";
  assert.equal(redirect(rules, "https://dev.azure.com/cabochons/review-deck/_git/review-deck/pullrequest/69"), deck);
  assert.equal(redirect(rules, "https://dev.azure.com/cabochons/review-deck/_git/review-deck/pullrequest/69?_a=files&path=/a.ts"), deck);
  assert.equal(redirect(rules, "https://dev.azure.com/Cabochons/review-deck/_git/other-repo/pullRequest/69/"), deck);
  assert.equal(redirect(rules, "https://cabochons.visualstudio.com/DefaultCollection/review-deck/_git/review-deck/pullrequest/69"), deck);
  assert.equal(redirect(rules, "https://cabochons.visualstudio.com/review-deck/_git/review-deck/pullrequest/69"), deck);
  assert.equal(
    redirect(rules, "https://dev.azure.com/nventive/My%20Project/_git/api/pullrequest/4321"),
    "https://dev.azure.com/nventive/My%20Project/_apps/hub/WepointCanada.review-deck.review-hub?pr=4321",
  );
});

test("Given any other link, then no browser redirects it", () => {
  const rules = redirectRules(parseDecks(deckLink).decks);
  for (const url of [
    "https://dev.azure.com/other-org/review-deck/_git/review-deck/pullrequest/69",
    "https://dev.azure.com/cabochons-two/review-deck/_git/review-deck/pullrequest/69",
    "https://dev.azure.com/cabochons/review-deck/_git/review-deck/pullrequests?_a=mine",
    "https://dev.azure.com/cabochons/review-deck/_git/review-deck/pullrequestcreate?sourceRef=a",
    "https://dev.azure.com/cabochons/review-deck/_git/review-deck?path=/pullrequest/69",
    "https://dev.azure.com/cabochons/review-deck/_apps/hub/Cabochonio.review-deck.review-hub?pr=69",
    "https://dev.azure.com/cabochons/_git/review-deck/pullrequest/69",
  ]) {
    assert.equal(redirect(rules, url), null, url);
  }
});
