import assert from "node:assert/strict";
import { test } from "node:test";
import { timingRows, TimingsRejected } from "../src/timings.js";

const now = new Date("2026-11-23T12:00:05.000Z");

const event = {
  kind: "load",
  at: "2026-11-23T12:00:00.000Z",
  outcome: "settled",
  totalMs: 912.4,
  steps: { handshake: 150, prLive: 730, diff: 900 },
  context: { organization: "cabochons", projectId: "p-1", version: "0.4.0", browser: "Chrome 142", view: "pr", pr: 471 },
  rest: { calls: 2, slowestMs: 520, firstStart: 200, lastEnd: 730, list: [] },
  assets: { files: 1, cached: 1, transferKb: 0 },
};

test("Given a page's event, then its row has the columns Grafana filters on and the whole event", () => {
  const [row] = timingRows({ events: [event] }, now);
  assert.deepEqual(
    { ...row, Event: undefined },
    {
      TimeGenerated: "2026-11-23T12:00:00.000Z",
      Kind: "load",
      Outcome: "settled",
      View: "pr",
      Organization: "cabochons",
      ProjectId: "p-1",
      Version: "0.4.0",
      Browser: "Chrome 142",
      TotalMs: 912,
      Event: undefined,
    },
  );
  assert.deepEqual(row.Event, event);
});

test("Given an event whose clock is days off, then its row takes the time it arrived", () => {
  const [row] = timingRows({ events: [{ ...event, at: "2020-01-01T00:00:00.000Z" }] }, now);
  assert.equal(row.TimeGenerated, now.toISOString());
});

test("Given bodies that aren't the page's events, then they're refused before anything is written", () => {
  const refused = (body: unknown) => assert.throws(() => timingRows(body, now), TimingsRejected);
  refused(null);
  refused({ events: [] });
  refused({ events: Array.from({ length: 21 }, () => event) });
  refused({ events: [{ ...event, kind: "click" }] });
  refused({ events: [{ ...event, outcome: "maybe" }] });
  refused({ events: [{ ...event, totalMs: "fast" }] });
  refused({ events: [{ ...event, padding: "x".repeat(17_000) }] });
});
