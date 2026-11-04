import * as React from "react";
import type { HubSnapshot } from "../../data/hubCache";
import { type DetailRecord, type DetailScope, detailScope, type PrListSource, type PrSummary, withDetails } from "../../data/list";
import { detailsDue, keptRecords, rowKey } from "./detailsDue";

/** Concurrent per-PR detail requests (up to three API calls each). */
const DETAIL_WORKERS = 6;

const canObserve = typeof IntersectionObserver !== "undefined";

export interface RowDetails {
  details: Map<number, Partial<PrSummary>>;
  /** When each row's details were fetched, for the hub to save with them. */
  records: ReadonlyMap<number, DetailRecord>;
  /** Some rows' details are being fetched. */
  loading: boolean;
  /** Same as `loading`, but current inside effects that run in the commit that queued the requests. */
  busy(): boolean;
  /** Facts the PR page just loaded for a row, applied at once and counted as fetched now; `row` is the row as patched. */
  merge(id: number, extra: Partial<PrSummary>, row: Partial<Pick<PrSummary, "reviewers" | "targetBranch">>): void;
  /**
   * A new list arrived. PRs no longer listed are forgotten. Details fetched less than DETAILS_FRESH_MS ago for rows
   * that didn't change stand (`detailsDue`); with `everything` (the Refresh button) every row is due again.
   */
  listLoaded(rows: PrSummary[], everything: boolean): void;
  /**
   * Called each render with what's on the page: your open, non-draft PRs, and the rows in open sections in display
   * order. (Those depend on `details`, so they can't be options.)
   */
  want(own: PrSummary[], rows: PrSummary[]): void;
}

/**
 * Fetches the per-PR facts the list leaves out (checks, comment counts) where the host needs extra calls for them.
 * Your open PRs come first: their review policies decide between Approved and Waiting for review, which takes only
 * the policy call while they're off screen. Then rows near the viewport, top first, so the rest load as you scroll.
 * Rows carry `data-pr`. Details already shown stay until their refetch lands, and they're only fetched again once
 * they're DETAILS_FRESH_MS old (or the row changed), not on every list refresh.
 */
export function useRowDetails(options: {
  source: PrListSource | null;
  active: boolean;
  container: React.RefObject<HTMLElement>;
  /** The hub's last visit. Its details show at once, and count as fetched when they were (`keptRecords`). */
  initial: Pick<HubSnapshot, "details" | "fetched"> | null;
}): RowDetails {
  const { source, active, container } = options;
  const page = React.useRef<{ own: PrSummary[]; rows: PrSummary[] }>({ own: [], rows: [] });
  const [details, setDetails] = React.useState(() => options.initial?.details ?? new Map<number, Partial<PrSummary>>());
  // What each row's details were last fetched with; in flight, by the Refresh (count) that was current when asked.
  const [fetched] = React.useState(() => (options.initial ? keptRecords(options.initial) : new Map<number, DetailRecord>()));
  const refreshes = React.useRef(0);
  const inFlight = React.useRef(new Map<number, number>());
  const [loading, setLoading] = React.useState(false);

  const nearView = React.useRef(new Set<number>());
  const [, rerender] = React.useReducer((n: number) => n + 1, 0);
  const [observer] = React.useState(() =>
    canObserve
      ? new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              const id = Number((e.target as HTMLElement).dataset.pr);
              if (e.isIntersecting) nearView.current.add(id);
              else nearView.current.delete(id);
            }
            rerender(); // rows that came near the viewport join the queue
          },
          // An explicit document root: in Azure DevOps' cross-origin iframe the implicit root ignores rootMargin.
          { root: document, rootMargin: "600px 0px" },
        )
      : null,
  );
  const observed = React.useRef(new Set<HTMLElement>());
  React.useEffect(() => () => observer?.disconnect(), [observer]);
  React.useEffect(() => {
    if (!observer) return;
    for (const el of observed.current) {
      if (el.isConnected) continue;
      observer.unobserve(el);
      observed.current.delete(el);
      nearView.current.delete(Number(el.dataset.pr));
    }
    for (const el of container.current?.querySelectorAll<HTMLElement>("[data-pr]") ?? []) {
      if (observed.current.has(el)) continue;
      observer.observe(el);
      observed.current.add(el);
    }
  });

  const fetchWanted = () => {
    if (source?.details && active) {
      const { own, rows } = page.current;
      const near = (id: number) => !canObserve || nearView.current.has(id);
      const shown = new Set(rows.map((p) => p.id));
      const wanted: { pr: PrSummary; scope: DetailScope }[] = [
        ...own.map((pr) => ({ pr, scope: shown.has(pr.id) && near(pr.id) ? ("full" as const) : ("review" as const) })),
        ...rows.filter((p) => near(p.id)).map((pr) => ({ pr, scope: "full" as const })),
      ];
      const now = Date.now();
      for (const { pr, scope } of wanted) {
        if (inFlight.current.size >= DETAIL_WORKERS) break;
        if (inFlight.current.has(pr.id) || !detailsDue(fetched.get(pr.id), pr, scope, now)) continue;
        const asked = refreshes.current;
        const since = Date.now();
        inFlight.current.set(pr.id, asked);
        const done = (extra: Partial<PrSummary> | null) => {
          inFlight.current.delete(pr.id);
          // A record newer than this request is the PR page's patch (`merge`), which landed meanwhile. Its facts are
          // newer than this answer's, so neither the answer nor its record replaces them.
          const patched = (fetched.get(pr.id)?.at ?? 0) >= since;
          if (!patched) {
            // A request from before a Refresh still shows newer facts, but the reader asked for everything anew, so it
            // doesn't count as fetched. A failure counts as a full fetch, so it isn't retried in a loop. The next
            // Refresh, or DETAILS_FRESH_MS, tries again.
            if (asked === refreshes.current) fetched.set(pr.id, { scope: extra ? scope : "full", at: Date.now(), row: rowKey(pr) });
            if (extra) setDetails((m) => withDetails(m, pr.id, extra));
          }
          fetchWantedRef.current();
        };
        source.details(pr, scope).then(done, () => done(null));
      }
    }
    // Also while a PR page covers the hub, since a request that lands meanwhile must still turn the "Updating…" bar off.
    setLoading(inFlight.current.size > 0);
  };
  const fetchWantedRef = React.useRef(fetchWanted);
  fetchWantedRef.current = fetchWanted;
  React.useEffect(() => fetchWanted());

  return {
    details,
    records: fetched,
    loading,
    busy: () => inFlight.current.size > 0,
    merge: React.useCallback(
      (id, extra, row) => {
        fetched.set(id, { scope: detailScope(extra), at: Date.now(), row: rowKey(row) });
        setDetails((m) => withDetails(m, id, extra));
      },
      [fetched],
    ),
    listLoaded: React.useCallback(
      (rows, everything) => {
        if (everything) {
          refreshes.current++;
          fetched.clear();
        }
        const ids = new Set(rows.map((p) => p.id));
        for (const id of [...fetched.keys()]) if (!ids.has(id)) fetched.delete(id);
        setDetails((m) => new Map([...m].filter(([id]) => ids.has(id))));
      },
      [fetched],
    ),
    want: (own, rows) => {
      page.current = { own, rows };
    },
  };
}
