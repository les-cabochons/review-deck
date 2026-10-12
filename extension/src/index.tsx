import "azure-devops-ui/Core/override.css";
import "./styles.css";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { MockPrSource } from "./data/mockSource";
import type { PrSource } from "./data/model";
import { App } from "./ui/App";

const root = document.getElementById("root")!;
const params = new URLSearchParams(location.search);

/**
 * Two ways to run:
 * - inside Azure DevOps (iframe): the hub gets `pr` and `repo` query params from the host page;
 * - locally: `dist/review.html?mock=<id>` serves a snapshot from dev-data/ (see scripts/build-ado-mock.ts).
 */
async function createSource(): Promise<PrSource | null> {
  const mock = params.get("mock");
  if (mock) return MockPrSource.fetch(`../dev-data/${encodeURIComponent(mock)}.json`);
  if (window.parent === window) return null;

  const SDK = await import("azure-devops-extension-sdk");
  const { CommonServiceIds } = await import("azure-devops-extension-api");
  const { AdoPrSource } = await import("./data/adoSource");
  await SDK.init({ loaded: false, applyTheme: true });
  await SDK.ready();
  const nav = await SDK.getService<{ getQueryParams(): Promise<Record<string, string>> }>(CommonServiceIds.HostNavigationService);
  const query = await nav.getQueryParams();
  const project = SDK.getWebContext().project.id;
  const prId = Number(query.pr ?? query.pullRequestId);
  if (!prId || !query.repo) throw new Error("Open this page from a pull request (missing ?pr=<id>&repo=<id>).");
  SDK.notifyLoadSucceeded();
  return new AdoPrSource(project, query.repo, prId);
}

const MockPicker: React.FC = () => (
  <div className="mock-picker">
    <h1>Semantic PR review: local dev</h1>
    <p>
      Not running inside Azure DevOps. Open a mock snapshot (build them with <code>npm run ext:mock</code>):
    </p>
    <ul>
      {["t3code-17901", "t3code-17563", "t3code-17826"].map((id) => (
        <li key={id}>
          <a href={`?mock=${id}`}>{id}</a>
        </li>
      ))}
    </ul>
  </div>
);

createSource()
  .then((source) => ReactDOM.render(source ? <App source={source} /> : <MockPicker />, root))
  .catch((e: Error) => ReactDOM.render(<div className="error-box page-error">{e.message}</div>, root));
