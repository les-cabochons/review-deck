import "azure-devops-ui/Core/override.css";
import "./styles.css";
import * as SDK from "azure-devops-extension-sdk";
import { startHostedPage, withTimeout } from "./startup";

const root = document.getElementById("root")!;
const params = new URLSearchParams(location.search);

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
  const [{ AdoHost }, { renderHost }, { connectPreferences }] = await withTimeout(
    Promise.all([import("./app/adoHost"), import("./page"), import("./ui/preferences")]),
    "The review code could not finish loading. Check your connection and reload.",
  );
  const host = await withTimeout(AdoHost.create(), "Could not connect to Azure DevOps navigation. Reload to try again.");
  // Bounded wait: if the user's saved preferences are slow, the page opens with this browser's.
  await connectPreferences(host.preferences());
  renderHost(host);
}

// Local mode: opened directly, or inside the dev shell (?local), or an old ?mock= link.
const local = window.parent === window || params.has("local") || params.has("mock");
if (!local) {
  void startHostedPage(SDK, renderHosted, showError);
} else {
  import("./page").then((page) => page.renderLocal()).catch(showError);
}
