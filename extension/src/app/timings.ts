/**
 * Load timings: one wide event per page load, and one per move inside the page (hub → PR, PR → hub, back and
 * forward), with the time of each step and the REST calls made meanwhile. Every event goes to the console as
 * `[review-deck] timing`. An organization that turns on "Send load timings" (Organization settings → Review Deck)
 * also sends them to its backend, which writes them to Log Analytics (backend/src/timings.ts, infra/timings.tf).
 *
 * Times are in ms since the trace started. A load starts when Azure DevOps creates the Deck's frame
 * (performance.timeOrigin): the Azure DevOps page's own load before that isn't visible from the frame. A move starts
 * when the route changes (ui/Root.tsx).
 *
 * No imports, so src/index.ts can load it before the host handshake without pulling in anything else.
 */

/** The steps a trace records, each once, at the first time it happens. */
export type TimingStep =
  /** SDK.init answered: the host handshake is done. */
  | "handshake"
  /** The host acknowledged notifyLoadSucceeded: its spinner is gone and the frame shows. */
  | "shown"
  /** The host adapter is ready and the route is known (a `?pr=<id>` link's repository found). */
  | "host"
  /** The page's code (page.tsx and its chunks) has loaded. */
  | "ui"
  /** React rendered the route for the first time. */
  | "rendered"
  /** The PR and its updates are in: the page shows them (PrOverview.partial). */
  | "prPartial"
  /** The whole overview is in: the buttons work. */
  | "prLive"
  /** The diff can show: the preview or the saved guided view. */
  | "diff"
  /** The guided view is grouped. */
  | "grouped"
  /** The hub shows rows, kept or listed. */
  | "hubRows"
  /** The hub's list landed from Azure DevOps. */
  | "hubListed";

/** Steps that belong to one view: a late step of a view the reader left doesn't count in the next view's trace. */
const STEP_VIEW: Partial<Record<TimingStep, string>> = {
  prPartial: "pr",
  prLive: "pr",
  diff: "pr",
  grouped: "pr",
  hubRows: "hub",
  hubListed: "hub",
};

export type TimingOutcome =
  /** Every step the view waits for happened. */
  | "settled"
  /** The view showed an error. */
  | "error"
  /** The view hadn't settled after TRACE_TIMEOUT_MS. */
  | "timeout"
  /** The reader moved on, or closed the page, before it settled. */
  | "left"
  /** The organization turned the feature off for this project. */
  | "off";

type Value = string | number | boolean;

export interface TimingEvent {
  kind: "load" | "navigate";
  /** When the trace started, ISO 8601. */
  at: string;
  outcome: TimingOutcome;
  /** The error the view showed, cut to 300 characters. */
  error?: string;
  /** When the trace ended, in ms since it started. */
  totalMs: number;
  steps: Partial<Record<TimingStep, number>>;
  /** What was shown and how: the session's (organization, version, browser) and the trace's (view, pr, kept copy). */
  context: Record<string, Value>;
  /** Azure DevOps REST calls that started during the trace. */
  rest: RestSummary;
  /** The Deck's own files (scripts, styles, grammars) fetched during the trace. */
  assets: AssetSummary;
  /** The frame's own document, for a load only. */
  frame?: FrameTiming;
}

export interface RestSummary {
  calls: number;
  /** The longest call. */
  slowestMs: number;
  /** From the first call's start to the last call's end, in ms since the trace started; 0 without calls. */
  firstStart: number;
  lastEnd: number;
  /** The first MAX_LISTED_CALLS calls, in start order. */
  list: { path: string; start: number; ms: number }[];
}

export interface AssetSummary {
  files: number;
  /** Served from the browser's cache (nothing transferred). */
  cached: number;
  transferKb: number;
}

export interface FrameTiming {
  /** The frame's HTML had arrived. */
  htmlMs: number;
  domContentLoadedMs: number;
  /** The first paint with content: the static skeleton. */
  firstPaintMs: number | null;
  /** "navigate", "reload" or "back_forward". */
  navigationType: string;
}

/** Where events go besides the console, once the settings say. Rejects when the export failed. */
export type TimingSink = (event: TimingEvent) => Promise<void>;

/** A view that never settles (a stuck REST call) still reports, as a timeout. */
export const TRACE_TIMEOUT_MS = 60_000;
const MAX_LISTED_CALLS = 40;
/** Events kept until the settings say whether to send them; more than this in one load is a page left open. */
const MAX_QUEUED = 20;
const MAX_RESOURCES = 2000;

/** What the tracer reads from the browser; tests pass their own. */
export interface TimingEnvironment {
  /** ms on the performance.now() clock. */
  now(): number;
  /** Epoch ms of performance.now() = 0. */
  timeOrigin: number;
  /** Calls `add` with each resource fetched since the frame started, and each one fetched later. */
  observeResources(add: (entry: ResourceEntry) => void): void;
  frame(): FrameTiming | undefined;
  /** The frame's origin, which serves the Deck's own files. */
  origin: string;
  log(event: TimingEvent): void;
  warn(message: string, error: unknown): void;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
}

export interface ResourceEntry {
  name: string;
  startTime: number;
  duration: number;
  transferSize: number;
  decodedBodySize: number;
}

interface Trace {
  kind: TimingEvent["kind"];
  start: number;
  steps: Partial<Record<TimingStep, number>>;
  context: Record<string, Value>;
  /** The view's steps that must all happen for it to settle; unknown until the view is named. */
  waitsFor: TimingStep[] | null;
  timer: unknown;
}

export class Timings {
  private trace: Trace | null;
  private readonly session: Record<string, Value> = {};
  private readonly resources: ResourceEntry[] = [];
  /** undefined until the settings say; null when the events stay in the console. */
  private sink: TimingSink | null | undefined = undefined;
  private queued: TimingEvent[] = [];

  constructor(private readonly env: TimingEnvironment) {
    env.observeResources((entry) => {
      this.resources.push(entry);
      if (this.resources.length > MAX_RESOURCES) this.resources.splice(0, this.resources.length - MAX_RESOURCES);
    });
    // The load's trace starts with the frame, at 0 on the performance clock.
    this.trace = this.begin("load", 0);
  }

  /** Context for every event of this page: organization, extension version, browser, page. */
  describe(fields: Record<string, Value | undefined>): void {
    for (const [key, value] of Object.entries(fields)) if (value !== undefined) this.session[key] = value;
  }

  /** Context for the current trace only: the PR, whether a kept copy showed, how its repository was found. */
  note(fields: Record<string, Value | undefined>): void {
    if (!this.trace) return;
    for (const [key, value] of Object.entries(fields)) if (value !== undefined) this.trace.context[key] = value;
  }

  /**
   * Names the view a trace is for, and the steps it settles on. The load's first view names the load's trace; every
   * later one ends the current trace (as "left", if it hadn't settled) and starts a "navigate" trace now.
   */
  view(view: string, waitsFor: TimingStep[], fields: Record<string, Value | undefined> = {}): void {
    if (this.trace && this.trace.waitsFor === null) {
      this.trace.waitsFor = waitsFor;
      this.trace.context.view = view;
      this.note(fields);
      this.settleIfDone();
      return;
    }
    if (this.trace) this.end("left");
    this.trace = this.begin("navigate", this.env.now());
    this.trace.waitsFor = waitsFor;
    this.trace.context.view = view;
    this.note(fields);
  }

  /**
   * Records a step, once per trace. `pr` names the pull request a PR page step is for, so a page the reader already
   * left doesn't mark the next PR's trace.
   */
  mark(step: TimingStep, scope: { pr?: number } = {}): void {
    const trace = this.trace;
    if (!trace || step in trace.steps) return;
    const view = STEP_VIEW[step];
    if (view && trace.context.view !== view) return;
    if (scope.pr !== undefined && trace.context.pr !== undefined && trace.context.pr !== scope.pr) return;
    trace.steps[step] = Math.round(this.env.now() - trace.start);
    this.settleIfDone();
  }

  /** The view showed an error, or turned out to be off: its trace ends now. */
  fail(outcome: "error" | "off", error?: string, scope: { pr?: number } = {}): void {
    const trace = this.trace;
    if (!trace) return;
    if (scope.pr !== undefined && trace.context.pr !== undefined && trace.context.pr !== scope.pr) return;
    this.end(outcome, error);
  }

  /** The page is going away: an unsettled trace reports as "left". */
  leave(): void {
    if (this.trace) this.end("left");
  }

  /**
   * Where events go besides the console, or null for the console only. Events of this load that ended before the
   * settings answered go now.
   */
  exportTo(sink: TimingSink | null): void {
    this.sink = sink;
    const queued = this.queued;
    this.queued = [];
    for (const event of queued) this.send(event);
  }

  private begin(kind: Trace["kind"], start: number): Trace {
    const timer = this.env.setTimeout(() => this.timeout(trace), TRACE_TIMEOUT_MS);
    const trace: Trace = { kind, start, steps: {}, context: {}, waitsFor: null, timer };
    return trace;
  }

  private timeout(trace: Trace): void {
    if (this.trace === trace) this.end("timeout");
  }

  private settleIfDone(): void {
    const trace = this.trace;
    if (trace?.waitsFor && trace.waitsFor.every((step) => step in trace.steps)) this.end("settled");
  }

  private end(outcome: TimingOutcome, error?: string): void {
    const trace = this.trace;
    if (!trace) return;
    this.trace = null;
    this.env.clearTimeout(trace.timer);
    const end = this.env.now();
    const during = this.resources.filter((r) => r.startTime >= trace.start && r.startTime <= end);
    const event: TimingEvent = {
      kind: trace.kind,
      at: new Date(this.env.timeOrigin + trace.start).toISOString(),
      outcome,
      ...(error ? { error: error.slice(0, 300) } : {}),
      totalMs: Math.round(end - trace.start),
      steps: trace.steps,
      context: { ...this.session, ...trace.context },
      rest: restSummary(during, trace.start),
      assets: assetSummary(during, this.env.origin),
      ...(trace.kind === "load" ? { frame: this.env.frame() } : {}),
    };
    this.env.log(event);
    this.send(event);
  }

  private send(event: TimingEvent): void {
    if (this.sink === null) return;
    if (this.sink === undefined) {
      if (this.queued.length < MAX_QUEUED) this.queued.push(event);
      return;
    }
    const sink = this.sink;
    sink(event).catch((error: unknown) => {
      // One warning, then the console only for the rest of this page: a backend without Log Analytics answers
      // every event with the same 503.
      if (this.sink === sink) this.sink = null;
      this.env.warn("[review-deck] could not send load timings to the backend; they stay in the console:", error);
    });
  }
}

/** Azure DevOps' REST hosts: dev.azure.com and its service subdomains (vssps, extmgmt…), and the old domain. */
function isAzureDevOps(hostname: string): boolean {
  return hostname === "dev.azure.com" || hostname.endsWith(".dev.azure.com") || hostname.endsWith(".visualstudio.com");
}

const ID_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{40})$/i;

/**
 * An Azure DevOps REST URL as a route that groups the same call across PRs: from `/_apis/` on, without the query,
 * with ids (numbers, GUIDs, commit hashes) as `{id}`. The organization and project before `/_apis/` are left out.
 * Null for any other URL.
 */
export function restPath(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!isAzureDevOps(parsed.hostname)) return null;
  const apis = parsed.pathname.indexOf("/_apis/");
  if (apis < 0) return "(other)";
  return parsed.pathname
    .slice(apis)
    .split("/")
    .map((segment) => (ID_SEGMENT.test(segment) ? "{id}" : segment))
    .join("/");
}

export function restSummary(entries: ResourceEntry[], start: number): RestSummary {
  const calls = entries
    .map((entry) => ({ entry, path: restPath(entry.name) }))
    .filter((c): c is { entry: ResourceEntry; path: string } => c.path !== null)
    .sort((a, b) => a.entry.startTime - b.entry.startTime);
  if (calls.length === 0) return { calls: 0, slowestMs: 0, firstStart: 0, lastEnd: 0, list: [] };
  const at = (ms: number) => Math.round(ms - start);
  return {
    calls: calls.length,
    slowestMs: Math.round(Math.max(...calls.map((c) => c.entry.duration))),
    firstStart: at(calls[0].entry.startTime),
    lastEnd: at(Math.max(...calls.map((c) => c.entry.startTime + c.entry.duration))),
    list: calls.slice(0, MAX_LISTED_CALLS).map((c) => ({ path: c.path, start: at(c.entry.startTime), ms: Math.round(c.entry.duration) })),
  };
}

export function assetSummary(entries: ResourceEntry[], origin: string): AssetSummary {
  const own = entries.filter((entry) => {
    try {
      return new URL(entry.name).origin === origin;
    } catch {
      return false;
    }
  });
  return {
    files: own.length,
    // A cached file transfers nothing but still has a body; a failed or opaque one has neither.
    cached: own.filter((entry) => entry.transferSize === 0 && entry.decodedBodySize > 0).length,
    transferKb: Math.round(own.reduce((sum, entry) => sum + entry.transferSize, 0) / 1024),
  };
}

const BROWSERS: [string, RegExp][] = [
  // Edge and Opera also say Chrome, and Chrome also says Safari: the more specific first.
  ["Edge", /Edg\/(\d+)/],
  ["Firefox", /Firefox\/(\d+)/],
  ["Chrome", /Chrome\/(\d+)/],
  ["Safari", /Version\/(\d+)\S* .*Safari\//],
];

/** "Edge 142", "Firefox 145", "Chrome 142", "Safari 26", or "other". */
export function browserName(userAgent: string): string {
  for (const [name, pattern] of BROWSERS) {
    const version = pattern.exec(userAgent)?.[1];
    if (version) return `${name} ${version}`;
  }
  return "other";
}

function browserEnvironment(): TimingEnvironment {
  return {
    now: () => performance.now(),
    timeOrigin: performance.timeOrigin,
    observeResources(add) {
      const copy = (entry: PerformanceEntry) => {
        const r = entry as PerformanceResourceTiming;
        add({ name: r.name, startTime: r.startTime, duration: r.duration, transferSize: r.transferSize, decodedBodySize: r.decodedBodySize });
      };
      try {
        // `buffered` also delivers what was fetched before this ran (review.js itself, its preloads).
        new PerformanceObserver((list) => list.getEntries().forEach(copy)).observe({ type: "resource", buffered: true });
      } catch {
        // No resource timing here (an old browser, a test page): events carry no calls.
      }
    },
    frame() {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (!nav) return undefined;
      const paint = performance.getEntriesByName("first-contentful-paint")[0];
      return {
        htmlMs: Math.round(nav.responseEnd),
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
        firstPaintMs: paint ? Math.round(paint.startTime) : null,
        navigationType: nav.type,
      };
    },
    origin: location.origin,
    log: (event) => console.info("[review-deck] timing", event),
    warn: (message, error) => console.warn(message, error),
    setTimeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  };
}

/** Outside a browser (node tests importing UI code) there's no clock to read: nothing is recorded or logged. */
function inertEnvironment(): TimingEnvironment {
  return {
    now: () => 0,
    timeOrigin: 0,
    observeResources: () => {},
    frame: () => undefined,
    origin: "",
    log: () => {},
    warn: () => {},
    setTimeout: () => undefined,
    clearTimeout: () => {},
  };
}

// Tests that fake `window` alone (own-guide.test.ts) count as outside a browser.
const inBrowser = typeof window !== "undefined" && typeof location !== "undefined" && typeof navigator !== "undefined" && typeof performance !== "undefined";

/** The page's tracer. */
export const timings = new Timings(inBrowser ? browserEnvironment() : inertEnvironment());

if (inBrowser) {
  // pagehide, not unload: it fires on mobile and with the back-forward cache too.
  window.addEventListener("pagehide", () => timings.leave());
  timings.describe({ browser: browserName(navigator.userAgent) });
}
