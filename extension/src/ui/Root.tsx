import * as React from "react";
import { type AppHost, type Route, sameRoute } from "../app/host";
import type { PrSource } from "../data/model";
import { PrPage } from "./App";
import { HubPage } from "./hub/HubPage";
import { PrSkeleton } from "./PrSkeleton";
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

  // The hub stays mounted behind PR pages once shown, so going back keeps its rows and scroll position and only
  // refreshes in the background. A link straight to a PR doesn't load the hub until you go to it.
  const onHub = route.view === "hub";
  const [hubShown, setHubShown] = React.useState(onHub);
  if (onHub && !hubShown) setHubShown(true);
  const hubScroll = React.useRef(0);
  const onHubRef = React.useRef(onHub);
  onHubRef.current = onHub;
  React.useEffect(() => {
    const save = () => onHubRef.current && (hubScroll.current = window.scrollY);
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, []);
  React.useEffect(() => {
    window.scrollTo(0, onHub ? hubScroll.current : 0);
  }, [route]);

  return (
    <ProjectTagsProvider host={host}>
      {hubShown && (
        <div hidden={!onHub}>
          <HubPage host={host} active={onHub} />
        </div>
      )}
      {route.view === "pr" && <PrRoute key={`${route.repo}/${route.pr}`} host={host} route={route} />}
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
  if (!source) return <PrSkeleton host={host} route={route} />;
  return <PrPage host={host} route={route} source={source} />;
};
