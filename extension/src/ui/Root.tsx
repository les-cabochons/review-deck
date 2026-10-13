import * as React from "react";
import { type AppHost, type Route, sameRoute } from "../app/host";
import type { PrSource } from "../data/model";
import { PrPage } from "./App";
import { HubPage } from "./hub/HubPage";
import { ProjectTagsProvider } from "./tags/Tags";

/** Switches between the PR hub and a pull request without reloading the page. */
export const Root: React.FC<{ host: AppHost }> = ({ host }) => {
  const [route, setRoute] = React.useState<Route>(() => host.route());
  React.useEffect(() => {
    const unsubscribe = host.subscribe((r) => setRoute((cur) => (sameRoute(cur, r) ? cur : r)));
    return () => {
      unsubscribe();
    };
  }, [host]);
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  return (
    <ProjectTagsProvider host={host}>
      {route.view === "hub" ? <HubPage host={host} /> : <PrRoute key={`${route.repo}/${route.pr}`} host={host} route={route} />}
    </ProjectTagsProvider>
  );
};

const PrRoute: React.FC<{ host: AppHost; route: Extract<Route, { view: "pr" }> }> = ({ host, route }) => {
  const [source, setSource] = React.useState<PrSource | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    host.prSource(route).then(setSource, (e: Error) => setError(e.message));
  }, [host, route]);
  if (error)
    return (
      <div className="page-error">
        <button className="crumb-link" onClick={() => host.navigate({ view: "hub" })}>
          ← Pull requests
        </button>
        <div className="error-box" role="alert">
          {error}
        </div>
      </div>
    );
  if (!source) return <div className="loading page-loading">Loading pull request…</div>;
  return <PrPage host={host} route={route} source={source} />;
};
