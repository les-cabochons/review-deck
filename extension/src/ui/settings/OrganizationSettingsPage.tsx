import { Toggle } from "azure-devops-ui/Toggle";
import * as React from "react";
import type { AppHost } from "../../app/host";
import type { OrganizationSettings } from "../../data/access";
import { BackendSetting } from "./BackendSetting";
import { FeatureAccess } from "./FeatureAccess";
import { SaveStatus } from "./SaveStatus";

/**
 * Organization settings → Review Deck (contribution "org-settings-hub", dist/org-settings.html). Organization
 * administrators choose which projects get the Deck and Changelog, whether AI group titles are allowed, and the
 * backend; everyone else sees them read-only.
 */
export const OrganizationSettingsPage: React.FC<{ host: AppHost }> = ({ host }) => {
  React.useEffect(() => {
    host.setTitle("Review Deck settings");
  }, [host]);
  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1>Review Deck</h1>
        <p className="muted">Settings for every project in this organization.</p>
      </header>
      <section className="settings-section" aria-labelledby="settings-features">
        <h2 id="settings-features">Deck and Changelog</h2>
        <FeatureAccess host={host} />
      </section>
      <section className="settings-section" aria-labelledby="settings-ai">
        <h2 id="settings-ai">AI group titles</h2>
        <OrganizationAiTitles host={host} />
      </section>
      <section className="settings-section" aria-labelledby="settings-backend">
        <h2 id="settings-backend">Backend</h2>
        <BackendSetting host={host} />
      </section>
    </div>
  );
};

/** The organization's switch over every project's AI titles: off, no project sends code to the LLM. */
const OrganizationAiTitles: React.FC<{ host: AppHost }> = ({ host }) => {
  const [settings, setSettings] = React.useState<OrganizationSettings | null>(null);
  const [canManage, setCanManage] = React.useState(false);
  const [status, setStatus] = React.useState<"saving" | "saved" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([host.organizationSettings(), host.canManageOrganization()]).then(([s, manage]) => {
      if (cancelled) return;
      setSettings(s);
      setCanManage(manage);
    });
    return () => {
      cancelled = true;
    };
  }, [host]);

  if (!settings) return null;

  const change = (aiTitles: boolean) => {
    setStatus("saving");
    setError(null);
    host.updateOrganizationSettings((s) => ({ ...s, aiTitles })).then(
      (next) => {
        setSettings(next);
        setStatus("saved");
      },
      (e: Error) => {
        setStatus(null);
        setError(`Couldn't save: ${e.message}`);
      },
    );
  };

  return (
    <div className="settings-field">
      <div className="settings-label-row">
        <Toggle text="Projects can use AI group titles" checked={settings.aiTitles} disabled={!canManage || status === "saving"} onChange={(_, on) => change(on)} />
        <SaveStatus status={status} />
      </div>
      <p className="settings-help muted">
        {settings.aiTitles
          ? "Each project's administrators choose whether to send changed lines to the backend's AI model for group titles. They're off until they do."
          : "Off for every project: groups get rule-based titles and no code is sent to an AI model, whatever a project chose."}
      </p>
      {!canManage && <p className="settings-help muted">Only organization administrators can change this.</p>}
      {error && (
        <p className="settings-help tone-warning" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
