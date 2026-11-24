import assert from "node:assert/strict";
import { test } from "node:test";
import { browserName, type ResourceEntry, restPath, type TimingEnvironment, type TimingEvent, Timings, TRACE_TIMEOUT_MS } from "../src/app/timings";

const ORIGIN = "https://cabochonio.gallerycdn.vsassets.io";

/** A tracer on a clock the test moves, with the resources it says were fetched. */
function tracer() {
  let clock = 0;
  let addResource: (entry: ResourceEntry) => void = () => {};
  const timers: { run: () => void; at: number }[] = [];
  const logged: TimingEvent[] = [];
  const env: TimingEnvironment = {
    now: () => clock,
    timeOrigin: Date.UTC(2026, 10, 23, 12),
    observeResources: (add) => (addResource = add),
    frame: () => ({ htmlMs: 40, domContentLoadedMs: 90, firstPaintMs: 110, navigationType: "navigate" }),
    origin: ORIGIN,
    log: (event) => logged.push(event),
    warn: () => {},
    setTimeout: (run, ms) => {
      const timer = { run, at: clock + ms };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => timers.splice(timers.indexOf(timer as (typeof timers)[number]), 1),
  };
  const timings = new Timings(env);
  return {
    timings,
    logged,
    /** Moves the clock, firing the timers due by then. */
    at(ms: number) {
      clock = ms;
      for (const timer of timers.filter((t) => t.at <= ms)) timer.run();
    },
    fetched(name: string, startTime: number, duration: number, transferSize = 500) {
      addResource({ name, startTime, duration, transferSize, decodedBodySize: 2000 });
    },
  };
}

test("Given a PR link, when its buttons work and its diff shows, then one load event reports each step and the REST calls", () => {
  const t = tracer();
  t.timings.describe({ organization: "cabochons", version: "0.4.0" });
  t.fetched(`${ORIGIN}/dist/review.js`, 20, 30, 0);
  t.at(150);
  t.timings.mark("handshake");
  t.timings.view("pr", ["prLive", "diff"], { pr: 471, tab: "files" });
  t.fetched("https://dev.azure.com/cabochons/Semantic_pr/_apis/git/repositories/0f3c1a2b-1111-2222-3333-444455556666/pullRequests/471?api-version=7.1", 200, 300);
  t.fetched("https://dev.azure.com/cabochons/Semantic_pr/_apis/git/repositories/0f3c1a2b-1111-2222-3333-444455556666/pullRequests/471/threads", 210, 520);
  t.at(500);
  t.timings.mark("prPartial", { pr: 471 });
  t.at(730);
  t.timings.mark("prLive", { pr: 471 });
  assert.equal(t.logged.length, 0, "the diff hasn't shown yet");
  t.at(900);
  t.timings.mark("diff", { pr: 471 });

  assert.equal(t.logged.length, 1);
  const [event] = t.logged;
  assert.equal(event.kind, "load");
  assert.equal(event.outcome, "settled");
  assert.equal(event.at, "2026-11-23T12:00:00.000Z");
  assert.equal(event.totalMs, 900);
  assert.deepEqual(event.steps, { handshake: 150, prPartial: 500, prLive: 730, diff: 900 });
  assert.deepEqual(event.context, { organization: "cabochons", version: "0.4.0", view: "pr", pr: 471, tab: "files" });
  assert.deepEqual(event.rest, {
    calls: 2,
    slowestMs: 520,
    firstStart: 200,
    lastEnd: 730,
    list: [
      { path: "/_apis/git/repositories/{id}/pullRequests/{id}", start: 200, ms: 300 },
      { path: "/_apis/git/repositories/{id}/pullRequests/{id}/threads", start: 210, ms: 520 },
    ],
  });
  assert.deepEqual(event.assets, { files: 1, cached: 1, transferKb: 0 });
  assert.equal(event.frame?.firstPaintMs, 110);
});

test("Given a PR page, when the reader goes back to the hub before it settles, then the PR's trace ends as left and the move starts its own", () => {
  const t = tracer();
  t.timings.view("pr", ["prLive", "diff"], { pr: 471 });
  t.at(400);
  t.timings.view("hub", ["hubListed"]);
  t.fetched("https://dev.azure.com/cabochons/_apis/git/pullrequests?searchCriteria.status=active", 420, 300);
  t.at(450);
  // The PR page's load lands after the reader left: it doesn't count in the hub's trace.
  t.timings.mark("prLive", { pr: 471 });
  t.at(760);
  t.timings.mark("hubListed");

  assert.deepEqual(
    t.logged.map((e) => [e.kind, e.context.view, e.outcome, e.totalMs]),
    [
      ["load", "pr", "left", 400],
      ["navigate", "hub", "settled", 360],
    ],
  );
  assert.deepEqual(t.logged[1].steps, { hubListed: 360 });
  assert.equal(t.logged[1].rest.calls, 1);
  assert.equal(t.logged[1].frame, undefined, "only a load has the frame's own document");
});

test("Given a move from one PR to another, when the first PR's page marks a step late, then the second PR's trace ignores it", () => {
  const t = tracer();
  t.timings.view("hub", ["hubListed"]);
  t.timings.mark("hubListed");
  t.at(1000);
  t.timings.view("pr", ["prLive", "diff"], { pr: 13 });
  t.timings.mark("diff", { pr: 12 });
  t.at(1300);
  t.timings.mark("prLive", { pr: 13 });
  t.timings.mark("diff", { pr: 13 });
  assert.deepEqual(t.logged[1].steps, { prLive: 300, diff: 300 });
});

test("Given a view that never settles, then its trace reports a timeout", () => {
  const t = tracer();
  t.timings.view("hub", ["hubListed"]);
  t.at(TRACE_TIMEOUT_MS);
  assert.deepEqual(t.logged.map((e) => [e.outcome, e.totalMs]), [["timeout", TRACE_TIMEOUT_MS]]);
});

test("Given events that end before the settings answer, then they go to the sink once it's known, and none go without one", async () => {
  const t = tracer();
  t.timings.view("hub", ["hubListed"]);
  t.timings.mark("hubListed");
  const sent: TimingEvent[] = [];
  t.timings.exportTo(async (event) => {
    sent.push(event);
  });
  assert.equal(sent.length, 1);

  const off = tracer();
  off.timings.exportTo(null);
  off.timings.view("hub", ["hubListed"]);
  off.timings.mark("hubListed");
  assert.equal(off.logged.length, 1, "it still goes to the console");
});

test("Given a backend that refuses an event, then the page stops sending for the rest of its life", async () => {
  const t = tracer();
  let attempts = 0;
  t.timings.exportTo(async () => {
    attempts++;
    throw new Error("timings service returned 503");
  });
  t.timings.view("hub", ["hubListed"]);
  t.timings.mark("hubListed");
  await new Promise((resolve) => setImmediate(resolve));
  t.timings.view("pr", ["prLive"], { pr: 1 });
  t.timings.mark("prLive", { pr: 1 });
  assert.equal(attempts, 1);
  assert.equal(t.logged.length, 2);
});

test("Given Azure DevOps REST URLs, then their routes leave out the organization, project, query and ids", () => {
  assert.equal(restPath("https://dev.azure.com/cabochons/Semantic%20pr/_apis/git/repositories/users-sdk/pullRequests/471/iterations/3/changes?$top=2000"), "/_apis/git/repositories/users-sdk/pullRequests/{id}/iterations/{id}/changes");
  assert.equal(restPath("https://cabochons.visualstudio.com/_apis/git/repositories/x/commits/0123456789abcdef0123456789abcdef01234567"), "/_apis/git/repositories/x/commits/{id}");
  assert.equal(restPath("https://extmgmt.dev.azure.com/cabochons/_apis/ExtensionManagement/InstalledExtensions/Cabochonio/review-deck/Data"), "/_apis/ExtensionManagement/InstalledExtensions/Cabochonio/review-deck/Data");
  assert.equal(restPath("https://dev.azure.com/cabochons/_signin"), "(other)");
  assert.equal(restPath(`${ORIGIN}/dist/review.js`), null);
  assert.equal(restPath("not a url"), null);
});

test("Given user agents, then the browser is named with its major version", () => {
  assert.equal(browserName("Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.3595.53"), "Edge 142");
  assert.equal(browserName("Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"), "Chrome 142");
  assert.equal(browserName("Mozilla/5.0 (Macintosh; rv:145.0) Gecko/20100101 Firefox/145.0"), "Firefox 145");
  assert.equal(browserName("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15"), "Safari 26");
  assert.equal(browserName("curl/8.7.1"), "other");
});
