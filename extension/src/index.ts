import "azure-devops-ui/Core/override.css";
import "./styles.css";
import * as SDK from "azure-devops-extension-sdk";
import { prSkeleton } from "./skeletons";
import { timings } from "./app/timings";
import { rememberHostTheme, startHostedPage, withTimeout } from "./startup";

const root = document.getElementById("root")!;
const params = new URLSearchParams(location.search);
/** review.html has no data-page; settings, organization settings and the changelog share this bundle. */
const isReview = (document.body.dataset.page ?? "review") === "review";
// Local mode: opened directly, or inside the dev shell (?local), or an old ?mock= link.
const local = window.parent === window || params.has("local") || params.has("mock");

// The UI downloads and parses while the host handshake runs (review.html also preloads these chunks), instead of
// after it. The static page shows the hub's skeleton meanwhile.
const ui = local ? null : { adoHost: import("./app/adoHost"), page: import("./page"), preferences: import("./ui/preferences") };
for (const chunk of Object.values(ui ?? {})) chunk.catch(() => {}); // reported where awaited

function showMessage(title: string, message: string) {
  const section = document.createElement("section");
  section.className = "startup-message";
  const heading = document.createElement("h1");
  heading.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = message;
  section.append(heading, paragraph);
  root.replaceChildren(section);
  return section;
}

function showError(error: Error) {
  const section = showMessage("Could not open the review", error.message);
  section.setAttribute("role", "alert");
  const retry = document.createElement("button");
  retry.textContent = "Reload review";
  retry.onclick = () => location.reload();
  section.append(retry);
}

async function renderHosted() {
  const { adoHost, page, preferences } = ui!;
  // A link with only the PR id (from the browser extension) waits for one REST call to find its repository: the PR's
  // skeleton shows meanwhile, not the hub's.
  const showPr = (id: number) => {
    // The page keeps its tab in its own hash (ui/App.tsx), so a reload on the Files tab shows that tab selected.
    if (isReview) root.innerHTML = prSkeleton({ id }, location.hash.slice(1));
  };
  const host = await withTimeout(
    adoHost.then(({ AdoHost }) =>
      AdoHost.create((id) => {
        // Only the browser extension's redirect (browser-extension/) links to a PR without its repository.
        timings.note({ link: "pr-id-only" });
        showPr(id);
      }),
    ),
    "Could not connect to Azure DevOps navigation. Reload to try again.",
  );
  timings.mark("host");
  // Started now, so the hub's on/off check (page.tsx, which doesn't hold up the first render) answers sooner.
  void host.organizationSettings();
  // The route is known now: a link straight to a pull request gets that page's skeleton, and its data starts
  // loading, the Files tab's reads included, while the UI loads.
  const route = host.route();
  if (route.view === "pr" && isReview) {
    showPr(route.pr);
    host.prefetchPr(route, { files: true });
  }
  const [{ renderHost }, { connectPreferences }] = await withTimeout(
    Promise.all([page, preferences]),
    "The review code could not finish loading. Check your connection and reload.",
  );
  timings.mark("ui");
  // The user's synced preferences never delay the first paint: the page opens with this browser's and adopts
  // theirs as they arrive (ui/preferences.ts preferencesLoaded).
  void connectPreferences(host.preferences());
  await renderHost(host);
}

/** The SDK calls startHostedPage makes, with the load's handshake and reveal marked (app/timings.ts). */
const timedSdk = {
  init: (options: SDK.IExtensionInitOptions) =>
    SDK.init(options).then(() => {
      timings.mark("handshake");
      const { publisherId, extensionId, version } = SDK.getExtensionContext();
      timings.describe({ organization: SDK.getHost().name, projectId: SDK.getWebContext().project?.id, extension: `${publisherId}.${extensionId}`, version });
    }),
  notifyLoadSucceeded: () => SDK.notifyLoadSucceeded().then(() => timings.mark("shown")),
  notifyLoadFailed: (error: Error) => {
    timings.fail("error", error.message);
    return SDK.notifyLoadFailed(error);
  },
};

if (!local) {
  rememberHostTheme();
  void startHostedPage(timedSdk, renderHosted, showError);
} else {
  import("./page").then((page) => page.renderLocal()).catch(showError);
}
