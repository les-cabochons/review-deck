import * as React from "react";
import type { AppHost, Route } from "../app/host";
import { prSkeletonHint } from "../data/hubCache";
import { prSkeletonBody } from "../skeletons";
import { Breadcrumb } from "./Breadcrumb";

/**
 * The PR page's layout while its data loads. What the hub already knows about the pull request (title, author,
 * branches, from the hub cache) shows for real; the rest is gray. Before React, src/index.ts paints the same
 * markup, so this only fills in the known facts and makes the breadcrumb work.
 */
export const PrSkeleton: React.FC<{ host: AppHost; route: Extract<Route, { view: "pr" }> }> = ({ host, route }) => {
  const hint = React.useMemo(() => prSkeletonHint(host.cacheScope, route.pr), [host, route.pr]);
  return (
    <div className="review-page" aria-busy="true" aria-label="Loading pull request">
      <Breadcrumb onBack={() => host.navigate({ view: "hub" })} repo={hint.repo} id={route.pr} nativeUrl={host.nativePrUrl(route)} />
      <div dangerouslySetInnerHTML={{ __html: prSkeletonBody(hint) }} />
    </div>
  );
};
