import { Toggle } from "azure-devops-ui/Toggle";
import * as React from "react";
import type { AppHost, ProjectSettings } from "../../app/host";
import { fetchUsage, type Usage } from "../../review/backend";

interface State {
  settings: ProjectSettings;
  canManage: boolean;
  /** Null until loaded, or if the backend can't report it. */
  usage: Usage | null;
  /** The backend didn't answer, so whether it has a model is unknown. */
  usageFailed: boolean;
  hasBackend: boolean;
}

/**
 * The project's opt-in for LLM group titles, at the bottom of the hub sidebar. Shown only when the
 * extension was built with a backend; only project administrators can switch it.
 */
export const AiTitlesSetting: React.FC<{ host: AppHost; /** Show (disabled) even without a backend, as on the settings page. */ alwaysShow?: boolean }> = ({ host, alwaysShow }) => {
  const [state, setState] = React.useState<State | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([host.backendService(), host.projectSettings(), host.canManageProject()]).then(([backend, settings, canManage]) => {
      if (cancelled || (!backend && !alwaysShow)) return;
      setState({ settings, canManage, usage: null, usageFailed: false, hasBackend: !!backend });
      if (!backend) return;
      fetchUsage(backend).then(
        (usage) => !cancelled && setState((s) => s && { ...s, usage }),
        (e) => {
          console.warn("[semantic-pr] AI title usage unavailable:", e);
          if (!cancelled) setState((s) => s && { ...s, usageFailed: true });
        },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [host]);

  if (!state) return null;
  const on = state.settings.aiTitles;
  // Turning titles on needs the backend to confirm a model; turning them off is always allowed.
  const model = state.usage?.model ?? null;
  const canTurnOn = state.hasBackend && model !== null;

  const change = (aiTitles: boolean) => {
    const settings = { ...state.settings, aiTitles };
    setSaving(true);
    setError(null);
    host
      .saveProjectSettings(settings)
      .then(() => setState({ ...state, settings }))
      .catch((e: Error) => setError(`Couldn't save: ${e.message}`))
      .finally(() => setSaving(false));
  };

  return (
    <div className="hub-setting">
      <div className="hub-sidebar-sep" />
      <Toggle text="AI group titles" checked={on} disabled={!state.canManage || saving || (!on && !canTurnOn)} onChange={(_, checked) => change(checked)} />
      <p className="hub-sidebar-note muted">
        {describe(state, on, model)} {!state.canManage && "Project administrators can change this."}
      </p>
      {state.usage && model !== null && <UsageNote usage={state.usage} />}
      {error && (
        <p className="hub-sidebar-note tone-warning" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

function describe(state: State, on: boolean, model: string | null): string {
  if (!state.hasBackend) return "Needs the backend, and this build has none: groups get rule-based titles.";
  if (state.usageFailed) return "Couldn't reach the backend to check its AI model, so titles can't be turned on right now.";
  if (!state.usage) return "Checking the backend's AI model…";
  if (model === null) return "The backend has no AI model set up: groups get rule-based titles and no code is sent to an LLM.";
  return on
    ? `This project sends each group's changed lines to ${model} (on the backend's Azure AI resource) to name the groups.`
    : `Off for this project: groups get rule-based titles and no code is sent to an LLM. Turning it on sends them to ${model}.`;
}

/** "This month: $0.03 of $0.25 for this project, $0.10 of $0.50 for the organization." */
const UsageNote: React.FC<{ usage: Usage }> = ({ usage }) => {
  const reached = usage.project.spentUsd >= usage.project.capUsd ? "project" : usage.organization.spentUsd >= usage.organization.capUsd ? "organization" : null;
  return (
    <p className={reached ? "hub-sidebar-note tone-warning" : "hub-sidebar-note muted"} role="status">
      This month: {usd(usage.project.spentUsd)} of {usd(usage.project.capUsd)} for this project, {usd(usage.organization.spentUsd)} of{" "}
      {usd(usage.organization.capUsd)} for the organization.
      {reached && ` The ${reached}'s budget is used up, so titles are rule-based until next month.`}
    </p>
  );
};

function usd(value: number): string {
  return `$${value < 0.01 && value > 0 ? value.toFixed(4) : value.toFixed(2)}`;
}
