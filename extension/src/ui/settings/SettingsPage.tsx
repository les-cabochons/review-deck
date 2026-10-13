import * as React from "react";
import type { AppHost } from "../../app/host";
import { AiTitlesSetting } from "../hub/AiTitlesSetting";
import { ChangelogSettings } from "./ChangelogSettings";
import { BackendSetting } from "./BackendSetting";
import { StackSettings } from "./StackSettings";

/**
 * Project settings → Review Deck (contribution "settings-hub", dist/settings.html).
 * Project administrators change the project's settings here, organization administrators the backend;
 * everyone else sees them read-only.
 */
export const SettingsPage: React.FC<{ host: AppHost }> = ({ host }) => {
  // Bumped when the backend changes, so the sections that depend on it load again.
  const [backendRevision, setBackendRevision] = React.useState(0);
  React.useEffect(() => {
    host.setTitle("Review Deck settings");
  }, [host]);
  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1>Review Deck</h1>
        <p className="muted">Settings for this project's pull request hub, review page and changelog.</p>
      </header>
      <section className="settings-section" aria-labelledby="settings-backend">
        <h2 id="settings-backend">Backend (organization)</h2>
        <BackendSetting host={host} onChange={() => setBackendRevision((r) => r + 1)} />
      </section>
      <section className="settings-section" aria-labelledby="settings-stacks">
        <h2 id="settings-stacks">Stacked pull requests</h2>
        <StackSettings key={backendRevision} host={host} />
      </section>
      <section className="settings-section" aria-labelledby="settings-changelog">
        <h2 id="settings-changelog">Changelog</h2>
        <ChangelogSettings host={host} />
      </section>
      <section className="settings-section" aria-labelledby="settings-ai">
        <h2 id="settings-ai">AI group titles</h2>
        <AiTitlesSetting key={backendRevision} host={host} alwaysShow />
      </section>
    </div>
  );
};
