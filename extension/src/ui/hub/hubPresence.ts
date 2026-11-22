import * as React from "react";
import type { AppHost } from "../../app/host";
import { CHECK_IN_MS, type Presence, sweep, whoIsOn } from "../../data/presence";

const NO_ONE: ReadonlyMap<number, Presence[]> = new Map();

/**
 * Who is on each listed pull request, by PR id, for the hub's rows. One read per project of `projectIds` (each holds
 * all its PRs' records, data/presence.ts), every CHECK_IN_MS while `active` and the tab is visible. The hub only
 * reads: it isn't on any PR. A project whose read fails shows no one until a read succeeds. Not active, it shows no
 * one, and becoming active again starts from no one: those of an earlier visit may have left meanwhile.
 */
export function useHubPresence(host: AppHost, projectIds: string[], active: boolean): ReadonlyMap<number, Presence[]> {
  const [people, setPeople] = React.useState(() => new Map<number, Presence[]>());
  const key = [...new Set(projectIds)].sort().join(",");

  React.useEffect(() => {
    // Cleared on stopping rather than on starting, so the first render of the next visit has no one to show.
    if (!active || !key) return void setPeople(new Map());
    let stopped = false;
    let busy = false;
    let warned = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped || busy || document.hidden) return;
      busy = true;
      clearTimeout(timer);
      const next = new Map<number, Presence[]>();
      await Promise.all(
        key.split(",").map(async (projectId) => {
          const store = host.presence(projectId);
          try {
            const records = await store.list();
            for (const [pr, list] of whoIsOn(records, host.currentUser.id, Date.now())) next.set(pr, list);
            void sweep(store, records, Date.now());
          } catch (e) {
            // Once per visit: a store that keeps failing would otherwise log at every read.
            if (!warned) console.warn("[review-deck] could not read who is on the pull requests:", e);
            warned = true;
          }
        }),
      );
      busy = false;
      if (stopped) return;
      setPeople(next);
      // A tab hidden meanwhile reads again once it shows (onVisibility).
      if (!document.hidden) timer = setTimeout(tick, CHECK_IN_MS);
    };
    const onVisibility = () => void tick();
    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [host, key, active]);

  return active ? people : NO_ONE;
}
