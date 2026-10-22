import "azure-devops-ui/Core/override.css";
import "./styles.css";
import * as SDK from "azure-devops-extension-sdk";
import { prSkeleton } from "./skeletons";
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
  const host = await withTimeout(
    adoHost.then(({ AdoHost }) => AdoHost.create()),
    "Could not connect to Azure DevOps navigation. Reload to try again.",
  );
  // Started now so the hub's on/off check (page.tsx) doesn't wait behind the UI chunks.
  void host.organizationSettings();
  // The route is known now: a link straight to a pull request gets that page's skeleton while the UI loads.
  const route = host.route();
  if (route.view === "pr" && isReview) root.innerHTML = prSkeleton({ id: route.pr });
  const [{ renderHost }, { connectPreferences }] = await withTimeout(
    Promise.all([page, preferences]),
    "The review code could not finish loading. Check your connection and reload.",
  );
  // The user's synced preferences never delay the first paint: the page opens with this browser's and adopts
  // theirs as they arrive (ui/preferences.ts preferencesLoaded).
  void connectPreferences(host.preferences());
  await renderHost(host);
}

if (!local) {
  rememberHostTheme();
  void startHostedPage(SDK, renderHosted, showError);
} else {
  import("./page").then((page) => page.renderLocal()).catch(showError);
}
