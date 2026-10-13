import { Button } from "azure-devops-ui/Button";
import { TextField } from "azure-devops-ui/TextField";
import { Toggle } from "azure-devops-ui/Toggle";
import * as React from "react";
import { invalidTrunkPattern, shortBranch } from "../../../../src/stack/branches";
import type { AppHost, ProjectSettings } from "../../app/host";

interface Row {
  id: number;
  value: string;
}

let rowIds = 0;
const toRows = (patterns: string[]): Row[] => patterns.map((value) => ({ id: ++rowIds, value }));

/**
 * Project settings for stacks: the trunk branches stacks end on, and auto-restack. Like Azure DevOps'
 * own settings pages there's no Save button: a pattern saves when its field loses focus (or on
 * Enter), and adding, removing or toggling saves at once. Only project administrators can edit.
 */
export const StackSettings: React.FC<{ host: AppHost }> = ({ host }) => {
  const [settings, setSettings] = React.useState<ProjectSettings | null>(null);
  const [canManage, setCanManage] = React.useState(false);
  const [hasBackend, setHasBackend] = React.useState(false);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [status, setStatus] = React.useState<"saving" | "saved" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // Saves read the latest settings, so a pattern edit and a toggle in quick succession don't overwrite each other.
  const latest = React.useRef<ProjectSettings | null>(null);
  const focusRow = React.useRef<number | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([host.projectSettings(), host.canManageProject(), host.backendService()]).then(([s, manage, backend]) => {
      if (cancelled) return;
      latest.current = s;
      setSettings(s);
      setRows(toRows(s.trunkBranches));
      setCanManage(manage);
      setHasBackend(!!backend);
    });
    return () => {
      cancelled = true;
    };
  }, [host]);

  React.useEffect(() => {
    if (focusRow.current === null) return;
    document.querySelector<HTMLInputElement>(`.trunk-rows li[data-row="${focusRow.current}"] input`)?.focus();
    focusRow.current = null;
  });

  if (!settings) return null;

  const save = async (change: Partial<ProjectSettings>) => {
    const next = { ...latest.current!, ...change };
    setStatus("saving");
    setError(null);
    try {
      await host.saveProjectSettings(next);
      latest.current = next;
      setSettings(next);
      setStatus("saved");
    } catch (e) {
      setStatus(null);
      setError(`Couldn't save: ${(e as Error).message}`);
      throw e;
    }
  };

  const problems = new Map(rows.map((r) => [r.id, r.value.trim() ? invalidTrunkPattern(shortBranch(r.value.trim())) : null]));
  /** Saves the list as shown, unless a pattern is invalid (it stays in its field, flagged, until fixed). */
  const commit = (next: Row[]) => {
    const patterns = [...new Set(next.map((r) => shortBranch(r.value.trim())).filter(Boolean))];
    const invalid = next.some((r) => r.value.trim() && invalidTrunkPattern(shortBranch(r.value.trim())));
    if (invalid || patterns.length === 0) return;
    if (patterns.join("\n") === latest.current!.trunkBranches.join("\n")) return;
    void save({ trunkBranches: patterns }).catch(() => {});
  };
  const edit = (id: number, value: string) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, value } : r)));
  const remove = (id: number) => {
    const next = rows.filter((r) => r.id !== id);
    setRows(next);
    commit(next);
  };
  const add = () => {
    const row = { id: ++rowIds, value: "" };
    focusRow.current = row.id;
    setRows([...rows, row]);
  };
  const lastValid = rows.filter((r) => r.value.trim()).length <= 1;

  return (
    <div className="stack-settings">
      <div className="settings-field">
        <div className="settings-label-row">
          <span className="settings-label" id="trunk-label">
            Trunk branches
          </span>
          <SaveStatus status={status} />
        </div>
        <p className="settings-help muted">
          PRs into these branches are the bottom of a stack; a PR into another PR's branch stacks on it. <code>*</code> matches within
          a folder (<code>*/00-*</code> matches <code>release/00-q4</code>), <code>**</code> across folders.
        </p>
        <ul className="trunk-rows" aria-labelledby="trunk-label">
          {rows.map((row) => (
            <li key={row.id} data-row={row.id}>
              <TextField
                value={row.value}
                placeholder="Branch name or pattern, e.g. release/*"
                ariaLabel="Trunk branch pattern"
                ariaInvalid={!!problems.get(row.id)}
                readOnly={!canManage}
                onChange={(_, value) => edit(row.id, value)}
                onBlur={() => commit(rows)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit(rows);
                }}
              />
              {canManage && (
                <Button
                  subtle
                  iconProps={{ iconName: "Delete" }}
                  ariaLabel={`Remove ${row.value || "empty pattern"}`}
                  tooltipProps={{ text: lastValid && row.value.trim() ? "Keep at least one trunk branch" : "Remove" }}
                  disabled={lastValid && !!row.value.trim()}
                  onClick={() => remove(row.id)}
                />
              )}
              {problems.get(row.id) && (
                <span className="trunk-problem tone-warning" role="alert">
                  {problems.get(row.id)}
                </span>
              )}
            </li>
          ))}
        </ul>
        {canManage && <Button className="trunk-add" subtle iconProps={{ iconName: "Add" }} text="Add branch pattern" onClick={add} />}
      </div>

      <div className="settings-field">
        <Toggle
          text="Auto-restack"
          checked={settings.autoRestack}
          disabled={!canManage || !hasBackend || status === "saving"}
          onChange={(_, on) => {
            setError(null);
            // Hooks first: saving "on" without them would promise restacks that never happen.
            const work = on
              ? host.syncRestackHooks(true).then(() => save({ autoRestack: true }))
              : save({ autoRestack: false }).then(() =>
                  host.syncRestackHooks(false).catch((e: Error) => setError(`Turned off, but the service hooks couldn't be removed: ${e.message}`)),
                );
            work.catch((e: Error) => {
              setStatus(null);
              setError(e.message);
            });
          }}
        />
        <p className="settings-help muted">
          {!hasBackend
            ? "Needs the backend, and this build has none."
            : settings.autoRestack
              ? "When a layer gets new commits or merges, the layers above are rebased on the server and retargeted. Conflicts are left alone, with a comment on the PR."
              : "Off: layers above a changed or merged PR stay where they are until someone rebases them."}
        </p>
      </div>
      {!canManage && <p className="settings-help muted">Only project administrators can change these settings.</p>}
      {error && (
        <p className="settings-help tone-warning" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

/** "Saving…" / "Saved", the quiet autosave confirmation Azure DevOps settings pages use. */
export const SaveStatus: React.FC<{ status: "saving" | "saved" | null }> = ({ status }) =>
  status ? (
    <span className="save-status muted" role="status">
      {status === "saving" ? "Saving…" : "Saved"}
    </span>
  ) : null;
