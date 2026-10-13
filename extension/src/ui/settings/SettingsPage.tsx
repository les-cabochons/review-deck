import * as React from "react";
import type { AppHost } from "../../app/host";
import { AiTitlesSetting } from "../hub/AiTitlesSetting";
import { StackSettings } from "./StackSettings";

/**
 * Project settings → Semantic PR Review (contribution "settings-hub", dist/settings.html).
 * Project administrators change the settings here; everyone else sees them read-only.
 */
export const SettingsPage: React.FC<{ host: AppHost }> = ({ host }) => {
  React.useEffect(() => {
    host.setTitle("Semantic PR Review settings");
  }, [host]);
  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1>Semantic PR Review</h1>
        <p className="muted">Settings for this project's pull request hub and review page.</p>
      </header>
      <section className="settings-section" aria-labelledby="settings-stacks">
        <h2 id="settings-stacks">Stacked pull requests</h2>
        <StackSettings host={host} />
      </section>
      <section className="settings-section" aria-labelledby="settings-ai">
        <h2 id="settings-ai">AI group titles</h2>
        <AiTitlesSetting host={host} alwaysShow />
      </section>
    </div>
  );
};
