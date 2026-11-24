// Load timings from the review page (extension/src/app/timings.ts), written to the Log Analytics table that
// infra/timings.tf creates, through its data collection rule and the Logs Ingestion API. The Function App's managed
// identity is the only writer: it has Monitoring Metrics Publisher on that rule, and no key exists.
import { identityToken } from "./identity.js";

/** infra/timings.tf sets all three; without them, POST /api/timings answers 503 and the page stops sending. */
const endpoint = process.env.TIMINGS_INGESTION_ENDPOINT ?? "";
const rule = process.env.TIMINGS_DCR_ID ?? "";
const stream = process.env.TIMINGS_STREAM ?? "";
export const timingsConfigured = !!(endpoint && rule && stream);

/** The page sends one event per request; a few more leave room for a later batch. */
const MAX_EVENTS = 20;
/** An event is about 3 KB with its 40 listed calls; past this it isn't one of the page's. */
const MAX_EVENT_BYTES = 16 * 1024;
const KINDS = new Set(["load", "navigate"]);
const OUTCOMES = new Set(["settled", "error", "timeout", "left", "off"]);
/** An event's own time is kept if it's within a day of when it arrives; otherwise the arrival time is used. */
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

/** A row of DeckTimings_CL: the columns Grafana filters on, and the whole event for the rest. */
export interface TimingRow {
  TimeGenerated: string;
  Kind: string;
  Outcome: string;
  View: string;
  Organization: string;
  ProjectId: string;
  Version: string;
  Browser: string;
  TotalMs: number;
  Event: Record<string, unknown>;
}

export class TimingsRejected extends Error {}

/** The rows for a POST /api/timings body, `{events: TimingEvent[]}`. Throws TimingsRejected for anything else. */
export function timingRows(body: unknown, now: Date): TimingRow[] {
  const events = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events) || events.length === 0) throw new TimingsRejected("expected {events: [...]}");
  if (events.length > MAX_EVENTS) throw new TimingsRejected(`at most ${MAX_EVENTS} events per request`);
  return events.map((event, i) => row(event, i, now));
}

function row(event: unknown, i: number, now: Date): TimingRow {
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new TimingsRejected(`events[${i}] isn't an object`);
  if (JSON.stringify(event).length > MAX_EVENT_BYTES) throw new TimingsRejected(`events[${i}] is over ${MAX_EVENT_BYTES} bytes`);
  const e = event as Record<string, unknown>;
  if (typeof e.kind !== "string" || !KINDS.has(e.kind)) throw new TimingsRejected(`events[${i}].kind must be load or navigate`);
  if (typeof e.outcome !== "string" || !OUTCOMES.has(e.outcome)) throw new TimingsRejected(`events[${i}].outcome is unknown`);
  if (typeof e.totalMs !== "number" || !Number.isFinite(e.totalMs) || e.totalMs < 0) throw new TimingsRejected(`events[${i}].totalMs must be a number of ms`);
  const context = e.context && typeof e.context === "object" ? (e.context as Record<string, unknown>) : {};
  const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 100) : "");
  return {
    TimeGenerated: eventTime(e.at, now),
    Kind: e.kind,
    Outcome: e.outcome,
    View: text(context.view),
    Organization: text(context.organization),
    ProjectId: text(context.projectId),
    Version: text(context.version),
    Browser: text(context.browser),
    TotalMs: Math.round(e.totalMs),
    Event: e,
  };
}

/** When the trace started, by the browser's clock, unless that clock is far off. */
function eventTime(at: unknown, now: Date): string {
  const time = typeof at === "string" ? Date.parse(at) : NaN;
  return Number.isFinite(time) && Math.abs(time - now.getTime()) <= MAX_CLOCK_SKEW_MS ? new Date(time).toISOString() : now.toISOString();
}

/** Writes the rows to Log Analytics. They show in queries a few minutes later. Throws on any refusal. */
export async function sendTimingRows(rows: TimingRow[]): Promise<void> {
  const url = `${endpoint.replace(/\/$/, "")}/dataCollectionRules/${encodeURIComponent(rule)}/streams/${encodeURIComponent(stream)}?api-version=2023-01-01`;
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${await identityToken("https://monitor.azure.com")}`, "content-type": "application/json" },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Logs Ingestion API returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
}
