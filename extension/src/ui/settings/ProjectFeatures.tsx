import { Toggle } from "azure-devops-ui/Toggle";
import * as React from "react";
import type { AppHost } from "../../app/host";
import { describeAccess, enabledFor, FEATURE_NAMES, type Feature, FEATURES, locked, type OrganizationSettings, VisibilityNotSynced, withProject } from "../../data/access";
import { SaveStatus } from "./SaveStatus";

/**
 * Project settings → Review Deck: this project's Deck and Changelog. Project administrators switch them here unless
 * the organization has set them for every project (Organization settings → Review Deck).
 */
export const ProjectFeatures: React.FC<{ host: AppHost }> = ({ host }) => {
  const [settings, setSettings] = React.useState<OrganizationSettings | null>(null);
  const [canManage, setCanManage] = React.useState(false);
  const [status, setStatus] = React.useState<"saving" | "saved" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([host.organizationSettings(), host.canManageProject()]).then(([s, manage]) => {
      if (cancelled) return;
      setSettings(s);
      setCanManage(manage);
    });
    return () => {
      cancelled = true;
    };
  }, [host]);

  if (!settings) return null;

  const change = (feature: Feature, on: boolean) => {
    setStatus("saving");
    setError(null);
    host
      .updateOrganizationSettings((s) => ({ ...s, [feature]: withProject(s[feature], host.projectId, on) }))
      .then((next) => {
        setSettings(next);
        return host.syncFeatureVisibility(feature, [host.projectId]);
      })
      .then(
        () => setStatus("saved"),
        (e: Error) => {
          setStatus(null);
          setError(e instanceof VisibilityNotSynced ? e.message : `Couldn't save: ${e.message}`);
        },
      );
  };

  return (
    <div className="project-features">
      <div className="settings-label-row">
        <SaveStatus status={status} />
      </div>
      {FEATURES.map((feature) => (
        <div key={feature} className="settings-field">
          <Toggle
            text={FEATURE_NAMES[feature]}
            checked={enabledFor(settings[feature], host.projectId)}
            disabled={!canManage || locked(settings[feature]) || status === "saving"}
            onChange={(_, on) => change(feature, on)}
          />
          <p className="settings-help muted">{describeAccess(settings[feature], host.projectId)}</p>
        </div>
      ))}
      {!canManage && <p className="settings-help muted">Only project administrators can change these settings.</p>}
      {error && (
        <p className="settings-help tone-warning" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
