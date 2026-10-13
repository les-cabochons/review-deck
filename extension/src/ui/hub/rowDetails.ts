import * as React from "react";
import { type DetailScope, type PrListSource, type PrSummary, withDetails } from "../../data/list";

/** Concurrent per-PR detail requests (up to three API calls each). */
const DETAIL_WORKERS = 6;

const canObserve = typeof IntersectionObserver !== "undefined";

export interface RowDetails {
  details: Map<number, Partial<PrSummary>>;
  /** Some rows' details are being fetched. */
  loading: boolean;
  /** Same as `loading`, but current inside effects that run in the commit that queued the requests. */
  busy(): boolean;
  /** Facts known from elsewhere (the PR page), applied at once. */
  merge(id: number, extra: Partial<PrSummary>): void;
  /** A new list arrived: everything is due again, and PRs no longer listed are forgotten. */
  listLoaded(ids: ReadonlySet<number>): void;
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
 * Rows carry `data-pr`. Details already shown stay until their refetch lands.
 */
export function useRowDetails(options: {
  source: PrListSource | null;
  active: boolean;
  container: React.RefObject<HTMLElement>;
  initial: Map<number, Partial<PrSummary>> | undefined;
}): RowDetails {
  const { source, active, container } = options;
  const page = React.useRef<{ own: PrSummary[]; rows: PrSummary[] }>({ own: [], rows: [] });
  const [details, setDetails] = React.useState(() => options.initial ?? new Map<number, Partial<PrSummary>>());
  // Fetched since the current list arrived (generation), by scope; in flight, by the generation that asked.
  const generation = React.useRef(0);
  const fetchedScope = React.useRef(new Map<number, DetailScope>());
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
    if (!source?.details || !active) return;
    const { own, rows } = page.current;
    const near = (id: number) => !canObserve || nearView.current.has(id);
    const shown = new Set(rows.map((p) => p.id));
    const wanted: { pr: PrSummary; scope: DetailScope }[] = [
      ...own.map((pr) => ({ pr, scope: shown.has(pr.id) && near(pr.id) ? ("full" as const) : ("review" as const) })),
      ...rows.filter((p) => near(p.id)).map((pr) => ({ pr, scope: "full" as const })),
    ];
    const covered = (id: number, want: DetailScope) => fetchedScope.current.get(id) === "full" || fetchedScope.current.get(id) === want;
    for (const { pr, scope } of wanted) {
      if (inFlight.current.size >= DETAIL_WORKERS) break;
      if (inFlight.current.has(pr.id) || covered(pr.id, scope)) continue;
      const asked = generation.current;
      inFlight.current.set(pr.id, asked);
      const done = (extra: Partial<PrSummary> | null) => {
        inFlight.current.delete(pr.id);
        // A request from before the latest list still shows newer facts than the cache, but doesn't count as fetched
        // for the new list. A failure counts as fetched, so it isn't retried in a loop; the next refresh tries again.
        if (asked === generation.current && !covered(pr.id, scope)) fetchedScope.current.set(pr.id, extra ? scope : "full");
        if (extra) setDetails((m) => withDetails(m, pr.id, extra));
        fetchWantedRef.current();
      };
      source.details(pr, scope).then(done, () => done(null));
    }
    setLoading(inFlight.current.size > 0);
  };
  const fetchWantedRef = React.useRef(fetchWanted);
  fetchWantedRef.current = fetchWanted;
  React.useEffect(() => fetchWanted());

  return {
    details,
    loading,
    busy: () => inFlight.current.size > 0,
    merge: React.useCallback((id, extra) => setDetails((m) => withDetails(m, id, extra)), []),
    listLoaded: React.useCallback((ids) => {
      generation.current++;
      fetchedScope.current.clear();
      setDetails((m) => new Map([...m].filter(([id]) => ids.has(id))));
    }, []),
    want: (own, rows) => {
      page.current = { own, rows };
    },
  };
}
