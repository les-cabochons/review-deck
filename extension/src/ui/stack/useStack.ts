import * as React from "react";
import { stackFor, type StackPosition } from "../../../../src/stack/stacks";
import type { AppHost } from "../../app/host";
import type { PrSummary } from "../../data/list";

export interface StackView {
  position: StackPosition<PrSummary>;
  /** Checks, comments and restack status per layer, filled in as they load. */
  details: Map<number, Partial<PrSummary>>;
  autoRestack: boolean;
  trunkBranches: string[];
}

/**
 * The stack the PR belongs to, from the project's open PRs and its trunk branch settings; null while
 * loading, when the PR isn't stacked, or if the PR list can't be read (the page works without it).
 */
export function useStack(host: AppHost, prId: number): StackView | null {
  const [view, setView] = React.useState<StackView | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    setView(null);
    (async () => {
      const [source, settings] = await Promise.all([host.listSource(), host.projectSettings()]);
      const prs = await source.list();
      const pr = prs.find((p) => p.id === prId);
      const position = pr && stackFor(pr, prs, settings.trunkBranches);
      if (cancelled || !position) return;
      const base: StackView = { position, details: new Map(), autoRestack: settings.autoRestack, trunkBranches: settings.trunkBranches };
      setView(base);
      if (!source.details) return;
      const layers = [...position.layers, ...position.children.filter((c) => !position.layers.includes(c))];
      await Promise.all(
        layers.map(async (layer) => {
          const extra = await source.details!(layer).catch(() => ({}));
          if (!cancelled) setView((v) => v && { ...v, details: new Map(v.details).set(layer.id, extra) });
        }),
      );
    })().catch((e: unknown) => console.warn("[review-deck] stack unavailable:", e));
    return () => {
      cancelled = true;
    };
  }, [host, prId]);
  return view;
}

/** A layer with its lazily loaded details merged in. */
export function withDetails(view: StackView, pr: PrSummary): PrSummary {
  return { ...pr, ...view.details.get(pr.id) };
}
