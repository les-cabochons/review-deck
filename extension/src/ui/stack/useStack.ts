import * as React from "react";
import { stackFor, type StackPosition } from "../../../../src/stack/stacks";
import type { AppHost } from "../../app/host";
import { listAroundPr, readHubSnapshot } from "../../data/hubCache";
import { detailScope, type PrSummary } from "../../data/list";

export interface StackView {
  position: StackPosition<PrSummary>;
  /** Checks, comments and restack status per layer, filled in as they load. */
  details: Map<number, Partial<PrSummary>>;
  autoRestack: boolean;
  trunkBranches: string[];
  /** Re-reads the stack (after a restack), keeping the current view until the new one is in. */
  reload: () => void;
}

/**
 * The stack the PR belongs to, from the project's open PRs and its trunk branch settings; null while
 * loading, when the PR isn't stacked, or if the PR list can't be read (the page works without it).
 * The open PRs come from the hub's kept list when it's fresh and covers the PR's repository (`listAroundPr`),
 * which is the case for a PR opened from a hub row, and so do the layers' details where the hub fetched them;
 * otherwise, and on `reload`, from the API.
 */
export function useStack(host: AppHost, prId: number): StackView | null {
  const [view, setView] = React.useState<StackView | null>(null);
  const [version, setVersion] = React.useState(0);
  const reload = React.useCallback(() => setVersion((v) => v + 1), []);
  const shownPr = React.useRef(prId);
  React.useEffect(() => {
    let cancelled = false;
    if (shownPr.current !== prId) setView(null);
    shownPr.current = prId;
    (async () => {
      const [source, settings] = await Promise.all([host.listSource(), host.projectSettings()]);
      const kept = version === 0 ? listAroundPr(readHubSnapshot(host.cacheScope), prId) : null;
      const prs = kept?.prs ?? (await source.list());
      const pr = prs.find((p) => p.id === prId);
      const position = pr && stackFor(pr, prs, settings.trunkBranches);
      if (cancelled) return;
      if (!position) return setView(null);
      const layers = [...position.layers, ...position.children.filter((c) => !position.layers.includes(c))];
      // The hub's details for a layer it showed are the same facts; its policy-only ones (a collapsed section) aren't enough.
      const details = new Map<number, Partial<PrSummary>>();
      for (const layer of layers) {
        const known = kept?.details.get(layer.id);
        if (known && detailScope(known) === "full") details.set(layer.id, known);
      }
      const base: StackView = { position, details, autoRestack: settings.autoRestack, trunkBranches: settings.trunkBranches, reload };
      setView(base);
      if (!source.details) return;
      await Promise.all(
        layers
          .filter((layer) => !details.has(layer.id))
          .map(async (layer) => {
            const extra = await source.details!(layer).catch(() => ({}));
            if (!cancelled) setView((v) => v && { ...v, details: new Map(v.details).set(layer.id, extra) });
          }),
      );
    })().catch((e: unknown) => console.warn("[review-deck] stack unavailable:", e));
    return () => {
      cancelled = true;
    };
  }, [host, prId, version, reload]);
  return view;
}

/** A layer with its lazily loaded details merged in. */
export function withDetails(view: StackView, pr: PrSummary): PrSummary {
  return { ...pr, ...view.details.get(pr.id) };
}
