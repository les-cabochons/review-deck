import { TextField, TextFieldWidth } from "azure-devops-ui/TextField";
import { Toggle } from "azure-devops-ui/Toggle";
import * as React from "react";
import type { AppHost } from "../../app/host";
import {
  enabledFor,
  FEATURE_MODES,
  FEATURE_NAMES,
  type Feature,
  type FeatureMode,
  FEATURES,
  locked,
  type OrganizationSettings,
  VisibilityNotSynced,
  withProject,
} from "../../data/access";
import { DropdownButton } from "../controls";
import { SaveStatus } from "./SaveStatus";

const MODE_NAMES: Record<FeatureMode, string> = {
  "default-on": "On by default, projects choose",
  "default-off": "Off by default, projects choose",
  on: "On for every project",
  off: "Off for every project",
};

const DESCRIPTIONS: Record<Feature, string> = {
  deck: "The pull request hub and review page under Repos, and Open in Review Deck in the pull request menu.",
  changelog: "Git tags, Releases and their pipeline Artifacts under Repos.",
};

/** Shown with a search box above it once the list gets long. */
const SEARCH_FROM = 8;

/**
 * Organization settings → Review Deck: for the Deck and the Changelog, whether projects choose (starting on or off)
 * or the organization sets it for all of them, and each project's state. Saves at once, like Azure DevOps' settings.
 */
export const FeatureAccess: React.FC<{ host: AppHost }> = ({ host }) => {
  const [settings, setSettings] = React.useState<OrganizationSettings | null>(null);
  const [projects, setProjects] = React.useState<{ id: string; name: string }[] | null>(null);
  const [canManage, setCanManage] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const [status, setStatus] = React.useState<"saving" | "saved" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([host.organizationSettings(), host.canManageOrganization()]).then(([s, manage]) => {
      if (cancelled) return;
      setSettings(s);
      setCanManage(manage);
    });
    host.organizationProjects().then(
      (list) => !cancelled && setProjects(list),
      (e: Error) => {
        if (cancelled) return;
        setProjects([]);
        setError(`Couldn't list the organization's projects: ${e.message}`);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [host]);

  if (!settings) return null;

  /** Saves, then shows or hides the hub in the projects affected (every project when `projectIds` is unset). */
  const save = (feature: Feature, change: (s: OrganizationSettings) => OrganizationSettings, projectIds?: string[]) => {
    setStatus("saving");
    setError(null);
    host
      .updateOrganizationSettings(change)
      .then((next) => {
        setSettings(next);
        return host.syncFeatureVisibility(feature, projectIds);
      })
      .then(
        () => setStatus("saved"),
        (e: Error) => {
          setStatus(null);
          setError(e instanceof VisibilityNotSynced ? e.message : `Couldn't save: ${e.message}`);
        },
      );
  };
  // Choosing the current mode again saves and syncs again too: the way to retry after the hub's visibility didn't update.
  const setMode = (feature: Feature, mode: FeatureMode) => save(feature, (s) => ({ ...s, [feature]: { ...s[feature], mode } }));
  const setProject = (feature: Feature, projectId: string, on: boolean) =>
    save(feature, (s) => ({ ...s, [feature]: withProject(s[feature], projectId, on) }), [projectId]);

  const query = filter.trim().toLowerCase();
  const shown = projects?.filter((p) => !query || p.name.toLowerCase().includes(query)) ?? [];

  return (
    <div className="feature-access">
      <div className="feature-modes">
        {FEATURES.map((feature) => (
          <div key={feature} className="feature-mode">
            <div>
              <div className="settings-label">{FEATURE_NAMES[feature]}</div>
              <p className="settings-help muted">{DESCRIPTIONS[feature]}</p>
            </div>
            <DropdownButton
              text={MODE_NAMES[settings[feature].mode]}
              ariaLabel={`Who gets the ${FEATURE_NAMES[feature]}`}
              disabled={!canManage || status === "saving"}
              options={FEATURE_MODES.map((mode) => ({
                id: mode,
                text: MODE_NAMES[mode],
                selected: settings[feature].mode === mode,
                onSelect: () => setMode(feature, mode),
              }))}
            />
          </div>
        ))}
      </div>

      <div className="settings-field">
        <div className="settings-label-row">
          <span className="settings-label" id="feature-projects-label">
            Projects
          </span>
          <SaveStatus status={status} />
        </div>
        <p className="settings-help muted">
          Projects that haven't chosen follow the default, as do new projects. Project administrators can also switch a feature in their Project
          settings → Review Deck, unless it's set for every project.
        </p>
        {projects && projects.length >= SEARCH_FROM && (
          <div className="feature-projects-search">
            <TextField value={filter} placeholder="Filter projects" ariaLabel="Filter projects" width={TextFieldWidth.auto} prefixIconProps={{ iconName: "Filter" }} onChange={(_, value) => setFilter(value)} />
          </div>
        )}
        {projects === null ? (
          <p className="settings-help muted" role="status">
            Loading projects…
          </p>
        ) : (
          <table className="feature-projects" aria-labelledby="feature-projects-label">
            <thead>
              <tr>
                <th scope="col">Project</th>
                {FEATURES.map((feature) => (
                  <th key={feature} scope="col">
                    {FEATURE_NAMES[feature]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((project) => (
                <tr key={project.id}>
                  <th scope="row">{project.name}</th>
                  {FEATURES.map((feature) => {
                    const policy = settings[feature];
                    const chosen = !locked(policy) && project.id in policy.projects;
                    return (
                      <td key={feature}>
                        <Toggle
                          checked={enabledFor(policy, project.id)}
                          disabled={!canManage || locked(policy) || status === "saving"}
                          ariaLabel={`${FEATURE_NAMES[feature]} in ${project.name}`}
                          tooltipProps={{ text: locked(policy) ? MODE_NAMES[policy.mode] : chosen ? "Set for this project" : "The default" }}
                          onChange={(_, on) => setProject(feature, project.id, on)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={FEATURES.length + 1} className="muted">
                    {query ? "No project matches." : "No projects."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      {!canManage && <p className="settings-help muted">Only organization administrators can change these settings.</p>}
      {error && (
        <p className="settings-help tone-warning" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
