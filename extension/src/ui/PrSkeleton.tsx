import * as React from "react";
import type { AppHost, Route } from "../app/host";
import { prSkeletonHint } from "../data/hubCache";
import { prSkeletonBody } from "../skeletons";
import { Breadcrumb } from "./Breadcrumb";
import { SkeletonHtml } from "./SkeletonHtml";

/**
 * The PR page's layout while its data loads. What the hub already knows about the pull request (title, author,
 * branches, from the hub cache) shows for real; the rest is gray. Before React, src/index.ts paints the same
 * markup, so this only fills in the known facts and makes the breadcrumb work. The tab it shows selected is the one
 * the page opens on, from the page's hash (ui/App.tsx).
 */
export const PrSkeleton: React.FC<{ host: AppHost; route: Extract<Route, { view: "pr" }> }> = ({ host, route }) => {
  const hint = React.useMemo(() => prSkeletonHint(host.cacheScope, route.pr), [host, route.pr]);
  return (
    <div className="review-page skeleton-page" aria-busy="true" aria-label="Loading pull request">
      <Breadcrumb onBack={() => host.navigate({ view: "hub" })} repo={hint.repo} id={route.pr} nativeUrl={host.nativePrUrl(route)} />
      <SkeletonHtml html={prSkeletonBody(hint, location.hash.slice(1))} />
    </div>
  );
};
