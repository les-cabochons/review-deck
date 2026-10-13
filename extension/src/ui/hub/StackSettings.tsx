import { Button } from "azure-devops-ui/Button";
import { Toggle } from "azure-devops-ui/Toggle";
import * as React from "react";
import { invalidTrunkPattern, parseTrunkPatterns } from "../../../../src/stack/branches";
import type { AppHost, ProjectSettings } from "../../app/host";

interface State {
  settings: ProjectSettings;
  canManage: boolean;
  hasBackend: boolean;
}

/**
 * Stack settings in the hub sidebar: the trunk branches stacks end on (main, dev, uat, *\/00-* …), and
 * auto-restack. Project administrators can change them; turning auto-restack on registers this
 * project's service hooks with the backend before the setting is saved.
 */
export const StackSettings: React.FC<{ host: AppHost; onTrunksChange: (trunks: string[]) => void }> = ({ host, onTrunksChange }) => {
  const [state, setState] = React.useState<State | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([host.projectSettings(), host.canManageProject(), host.backendService()]).then(([settings, canManage, backend]) => {
      if (!cancelled) setState({ settings, canManage, hasBackend: !!backend });
    });
    return () => {
      cancelled = true;
    };
  }, [host]);

  if (!state) return null;
  const { settings, canManage, hasBackend } = state;

  const save = async (next: ProjectSettings) => {
    await host.saveProjectSettings(next);
    setState((s) => s && { ...s, settings: next });
    onTrunksChange(next.trunkBranches);
  };
  const run = (work: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    work()
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false));
  };

  const draft = editing === null ? null : parseTrunkPatterns(editing);
  const problem = draft && (draft.length === 0 ? "Add at least one branch, such as main." : draft.map(invalidTrunkPattern).find(Boolean));

  return (
    <div className="hub-setting stack-settings">
      <div className="hub-sidebar-sep" />
      <div className="hub-setting-head">
        <strong>Stacks</strong>
        {canManage && editing === null && (
          <button className="link-button" onClick={() => setEditing(settings.trunkBranches.join("\n"))}>
            Edit
          </button>
        )}
      </div>
      <p className="hub-sidebar-note muted">PRs into these branches are the bottom of a stack; PRs into another PR's branch stack on it.</p>
      {editing === null ? (
        <div className="trunk-list" aria-label="Trunk branches">
          {settings.trunkBranches.map((t) => (
            <code key={t}>{t}</code>
          ))}
        </div>
      ) : (
        <div className="trunk-edit">
          <textarea
            aria-label="Trunk branches, one per line"
            value={editing}
            rows={Math.max(3, editing.split("\n").length)}
            onChange={(e) => setEditing(e.target.value)}
            placeholder={"main\ndev\nuat\n*/00-*"}
          />
          <p className="hub-sidebar-note muted">
            One per line. <code>*</code> matches within a folder (<code>*/00-*</code> → <code>release/00-q4</code>), <code>**</code> across folders.
          </p>
          {problem && (
            <p className="hub-sidebar-note tone-warning" role="alert">
              {problem}
            </p>
          )}
          <div className="trunk-edit-actions">
            <Button text="Cancel" subtle onClick={() => setEditing(null)} disabled={saving} />
            <Button
              text="Save"
              primary
              disabled={saving || !!problem}
              onClick={() => run(async () => {
                await save({ ...settings, trunkBranches: draft! });
                setEditing(null);
              })}
            />
          </div>
        </div>
      )}
      <Toggle
        text="Auto-restack"
        checked={settings.autoRestack}
        disabled={!canManage || !hasBackend || saving}
        onChange={(_, on) =>
          run(async () => {
            // Hooks first: saving "on" without them would promise restacks that never happen.
            if (on) await host.syncRestackHooks(true);
            await save({ ...settings, autoRestack: on });
            if (!on) await host.syncRestackHooks(false).catch((e: Error) => setError(`Turned off, but the service hooks couldn't be removed: ${e.message}`));
          })
        }
      />
      <p className="hub-sidebar-note muted">
        {!hasBackend
          ? "Auto-restack needs the backend, and this build has none."
          : settings.autoRestack
            ? "When a layer gets new commits or merges, the layers above are rebased on the server and retargeted. Conflicts are left alone, with a comment on the PR."
            : "Off: layers above a changed or merged PR stay where they are until someone rebases them."}{" "}
        {!canManage && "Project administrators can change this."}
      </p>
      {error && (
        <p className="hub-sidebar-note tone-warning" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
