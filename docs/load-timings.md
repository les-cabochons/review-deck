# Load timings

The startup work in [startup-loading.md](startup-loading.md) was measured against a stub of Azure DevOps. Load timings measure the real thing: each page records how long each step of its load took, and which Azure DevOps calls it waited on.

## What's recorded

`extension/src/app/timings.ts` keeps one trace per view and ends it as one wide event:

- A **load** trace starts when Azure DevOps creates the Deck's frame. The Azure DevOps page's own load before that isn't visible from the frame.
- A **navigate** trace starts when the route changes inside the page: hub to PR, PR to hub, back and forward.

A trace ends when its view settles, or earlier:

| View | Settles when | Steps it records |
| --- | --- | --- |
| `pr` | the buttons work (`prLive`) and the diff can show (`diff`) | `prPartial`, `prLive`, `diff`, `grouped` |
| `hub` | the list landed from Azure DevOps (`hubListed`) | `hubRows` (kept or listed rows show), `hubListed` |
| `settings`, `org-settings`, `changelog` | rendered | `rendered` |

A load also records `handshake` (SDK.init answered), `shown` (the host's spinner ended), `host` (the route is known, with a `?pr=<id>` link's repository found), `ui` (the page's code loaded) and `rendered`. Each step is in ms since the trace started.

The `outcome` is `settled`, `error` (the view showed an error), `timeout` (not settled after 60 s), `left` (the reader moved on or closed the page first) or `off` (the Deck is turned off for the project).

Each event also carries:

- `context`: organization, project id, extension version, browser, view, PR id and repository id, the tab, and how the PR got there. `link: "pr-id-only"` is a link from the browser extension, `repoLookup` says whether its repository came from the browser's cache or a REST call, `kept` and `fromRow` say whether a kept copy or the hub's row drew the page first, and `prefetched` whether the hub's hover prefetch was used.
- `rest`: the Azure DevOps calls that started during the trace, with their route (ids, organization, project and query left out), start and duration, the first 40 listed.
- `assets`: the Deck's own files fetched, and how many came from the browser cache.
- `frame`, for a load: when the frame's HTML arrived, DOMContentLoaded, and the first paint (the static skeleton).

No user id, name, title, description or code is recorded.

## Where it goes

Every event goes to the browser console as `[review-deck] timing`. To compare with Azure DevOps' own PR page, open both with DevTools' Performance panel, or Network panel, and read the Deck's steps from the console.

To keep them, an organization administrator turns on **Organization settings → Review Deck → Load timings → Send load timings to the backend**. It's off by default. Pages then post each event to the backend (`POST /api/timings`), which writes it to the `DeckTimings_CL` table of a Log Analytics workspace. The page reads the setting with the organization settings it reads anyway. If the backend answers with an error, the page warns once in the console and stops sending until it reloads.

## Deploy

`infra/timings.tf` creates the workspace with the backend (`just deploy-backend`), unless `load_timings = false`:

- the workspace, with 30 days of retention and a daily ingestion cap of `load_timings_daily_quota_gb` (0.1 GB, about 30,000 page loads);
- the `DeckTimings_CL` table, and the data collection endpoint and rule the function writes through;
- Monitoring Metrics Publisher on the rule for the function's managed identity, its only right there. No key exists.

`terraform output timings_workspace` gives the workspace's resource id and workspace id.

## Grafana

Add an **Azure Monitor** data source that signs in as Grafana's managed identity, or as an app registration. Give that identity Log Analytics Reader on the workspace: put its object id in `load_timings_readers` and apply. Query the workspace with KQL (Logs).

PR loads by step, median and 90th percentile:

```kusto
DeckTimings_CL
| where $__timeFilter(TimeGenerated) and Kind == "load" and View == "pr" and Outcome == "settled"
| extend handshake = toint(Event.steps.handshake), host = toint(Event.steps.host), partial = toint(Event.steps.prPartial),
         live = toint(Event.steps.prLive), diff = toint(Event.steps.diff)
| summarize p50_live = percentile(live, 50), p90_live = percentile(live, 90), p50_diff = percentile(diff, 50),
            p50_handshake = percentile(handshake, 50), p50_host = percentile(host, 50), p50_partial = percentile(partial, 50)
            by bin(TimeGenerated, 1h)
```

Hub to PR moves, with and without the hover prefetch:

```kusto
DeckTimings_CL
| where $__timeFilter(TimeGenerated) and Kind == "navigate" and View == "pr" and Outcome == "settled"
| extend prefetched = tostring(Event.context.prefetched), live = toint(Event.steps.prLive)
| summarize p50 = percentile(live, 50), p90 = percentile(live, 90), loads = count() by prefetched
```

The slowest REST routes:

```kusto
DeckTimings_CL
| where $__timeFilter(TimeGenerated)
| mv-expand call = Event.rest.list
| summarize p50 = percentile(toint(call.ms), 50), p90 = percentile(toint(call.ms), 90), calls = count() by route = tostring(call.path)
| top 15 by p90
```

Rows show in queries a few minutes after the page sends them.
