import { Toggle } from "azure-devops-ui/Toggle";
import * as React from "react";
import type { AppHost } from "../../app/host";
import type { OrganizationSettings } from "../../data/access";
import { BackendSetting } from "./BackendSetting";
import { FeatureAccess } from "./FeatureAccess";
import { LoadError, loadFailed } from "./LoadError";
import { SaveStatus } from "./SaveStatus";
import { SETTINGS_BODIES } from "../../skeletons";
import { SkeletonHtml } from "../SkeletonHtml";

/**
 * Organization settings → Review Deck (contribution "org-settings-hub", dist/org-settings.html). Organization
 * administrators choose which projects get the Deck and Changelog, whether AI group titles are allowed, the
 * backend, and whether pages send their load timings to it; everyone else sees them read-only.
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
      <section className="settings-section" aria-labelledby="settings-timings">
        <h2 id="settings-timings">Load timings</h2>
        <OrganizationLoadTimings host={host} />
      </section>
    </div>
  );
};

/** The organization's switch over every project's AI titles: off, no project sends code to the LLM. */
const OrganizationAiTitles: React.FC<{ host: AppHost }> = ({ host }) => (
  <OrganizationSwitch
    host={host}
    setting="aiTitles"
    label="Projects can use AI group titles"
    skeleton={SETTINGS_BODIES.orgAi}
    what="organization's AI group titles"
    help={(on) =>
      on
        ? "Each project's administrators choose whether to send changed lines to the backend's AI model for group titles. They're off until they do."
        : "Off for every project: groups get rule-based titles and no code is sent to an AI model, whatever a project chose."
    }
  />
);

/** Whether pages send their load timings (app/timings.ts) to the backend's Log Analytics workspace. */
const OrganizationLoadTimings: React.FC<{ host: AppHost }> = ({ host }) => (
  <OrganizationSwitch
    host={host}
    setting="loadTimings"
    label="Send load timings to the backend"
    skeleton={SETTINGS_BODIES.orgTimings}
    what="organization's load timings"
    help={(on) =>
      on
        ? "Each page load sends how long each step took, and which Azure DevOps calls it waited on, to the backend, which writes them to its Log Analytics workspace. It sends the organization, project and pull request ids, the browser and the extension version: no code, titles or names. Needs a backend deployed with load timings (infra/)."
        : "Pages write their load timings to the browser's console only."
    }
  />
);

/** One on/off organization setting, saved at once; read-only for anyone but organization administrators. */
const OrganizationSwitch: React.FC<{
  host: AppHost;
  setting: "aiTitles" | "loadTimings";
  label: string;
  /** The field's place in gray until it loads (skeletons.ts SETTINGS_BODIES). */
  skeleton: string;
  /** What failed to load, for the error message. */
  what: string;
  help: (on: boolean) => string;
}> = ({ host, setting, label, skeleton, what, help }) => {
  const [settings, setSettings] = React.useState<OrganizationSettings | null>(null);
  const [canManage, setCanManage] = React.useState(false);
  const [status, setStatus] = React.useState<"saving" | "saved" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([host.organizationSettings(), host.canManageOrganization()]).then(([s, manage]) => {
      if (cancelled) return;
      setSettings(s);
      setCanManage(manage);
    }, loadFailed(what, () => cancelled, setLoadError));
    return () => {
      cancelled = true;
    };
  }, [host]);

  if (loadError) return <LoadError message={loadError} />;
  if (!settings) return <SkeletonHtml html={skeleton} />;

  const change = (on: boolean) => {
    setStatus("saving");
    setError(null);
    host.updateOrganizationSettings((s) => ({ ...s, [setting]: on })).then(
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
        <Toggle text={label} checked={settings[setting]} disabled={!canManage || status === "saving"} onChange={(_, on) => change(on)} />
        <SaveStatus status={status} />
      </div>
      <p className="settings-help muted">{help(settings[setting])}</p>
      {!canManage && <p className="settings-help muted">Only organization administrators can change this.</p>}
      {error && (
        <p className="settings-help tone-warning" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
