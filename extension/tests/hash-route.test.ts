import assert from "node:assert/strict";
import { test } from "node:test";
import { HashRouter, type HostHistory, routeFromHash, routeHash } from "../src/app/hashRoute";
import type { Route } from "../src/app/host";

/** The host page's history as Azure DevOps exposes it: setHash pushes, replaceHash replaces, back and forward report the hash. */
function fakeHost(start: { hash?: string; query?: Record<string, string> } = {}) {
  const entries = [{ hash: start.hash ?? "", query: { ...start.query } }];
  let at = 0;
  let listener: (hash: string) => void = () => {};
  const go = (delta: number) => {
    const next = at + delta;
    if (next < 0) return "left the hub";
    if (next >= entries.length) return "nowhere";
    at = next;
    listener(entries[at].hash);
    return "stayed";
  };
  const host: HostHistory = {
    getHash: async () => entries[at].hash,
    getQueryParams: async () => entries[at].query,
    setHash: (hash) => {
      entries.splice(at + 1, Infinity, { hash, query: entries[at].query });
      at++;
      listener(hash);
    },
    replaceHash: (hash) => {
      entries[at] = { ...entries[at], hash };
      listener(hash);
    },
    setQueryParams: (params) => {
      const query = { ...entries[at].query };
      for (const [k, v] of Object.entries(params)) if (v) query[k] = v;
      else delete query[k];
      entries[at] = { ...entries[at], query };
    },
    onHashChanged: (callback) => void (listener = callback),
  };
  return { host, back: () => go(-1), forward: () => go(1), entry: () => entries[at] };
}

const pr = (n: number): Route => ({ view: "pr", repo: "repo-id", pr: n });

test("Given a route, then it round-trips through the hash; anything else is the hub", () => {
  assert.equal(routeHash(pr(12)), "pr=12&repo=repo-id");
  assert.deepEqual(routeFromHash("#pr=12&repo=repo-id"), pr(12));
  assert.equal(routeHash({ view: "hub" }), "");
  assert.deepEqual(routeFromHash(""), { view: "hub" });
  assert.deepEqual(routeFromHash("#overview"), { view: "hub" });
});

test("Given hub → PR → hub → another PR, then back walks the same pages in reverse, and forward again", async () => {
  const { host, back, forward } = fakeHost();
  const seen: Route[] = [];
  const router = await HashRouter.connect(host, (r) => seen.push(r));
  router.navigate(pr(1));
  router.navigate({ view: "hub" });
  router.navigate(pr(2));
  assert.deepEqual(seen, [], "the router's own navigation isn't reported back");

  assert.equal(back(), "stayed");
  assert.deepEqual(router.route(), { view: "hub" });
  assert.equal(back(), "stayed");
  assert.deepEqual(router.route(), pr(1));
  assert.equal(back(), "stayed");
  assert.deepEqual(router.route(), { view: "hub" });
  assert.equal(back(), "left the hub");
  assert.equal(forward(), "stayed");
  assert.deepEqual(router.route(), pr(1));
  assert.deepEqual(seen, [{ view: "hub" }, pr(1), { view: "hub" }, pr(1)]);
});

test("Given a link from the pull request menu (?pr=&repo=), then the PR opens, and the hub never reopens it", async () => {
  const { host, back, entry } = fakeHost({ query: { pr: "7", repo: "repo-id" } });
  const router = await HashRouter.connect(host, () => {});
  assert.deepEqual(router.route(), pr(7));
  assert.deepEqual(entry(), { hash: "pr=7&repo=repo-id", query: {} });

  router.navigate({ view: "hub" });
  assert.deepEqual(entry(), { hash: "", query: {} });
  back();
  assert.deepEqual(router.route(), pr(7));
});

test("Given a reload on a PR, then the hash reopens it", async () => {
  const { host } = fakeHost({ hash: "pr=9&repo=repo-id" });
  assert.deepEqual((await HashRouter.connect(host, () => {})).route(), pr(9));
});

test("Given a link to the current route, then no history entry is added", async () => {
  const { host, back } = fakeHost({ hash: "pr=9&repo=repo-id" });
  const router = await HashRouter.connect(host, () => {});
  router.navigate(pr(9));
  assert.equal(back(), "left the hub");
});
