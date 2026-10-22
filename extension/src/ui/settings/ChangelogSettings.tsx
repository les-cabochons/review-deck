import { TextField } from "azure-devops-ui/TextField";
import * as React from "react";
import type { AppHost } from "../../app/host";
import { DEFAULT_TAG_CONVENTION, type Pipeline, type ReleaseCatalog, type ReleaseSettings, type RepoReleaseSettings, type Repository } from "../../data/releases";
import { DropdownButton } from "../controls";
import { SaveStatus } from "./SaveStatus";

/**
 * Project settings for the Changelog hub: the tag convention, and per repository an override of it and the
 * publishing pipeline. Saves like the other sections: a field on blur or Enter, a choice at once.
 */
export const ChangelogSettings: React.FC<{ host: AppHost }> = ({ host }) => {
  const [catalog, setCatalog] = React.useState<ReleaseCatalog | null>(null);
  const [settings, setSettings] = React.useState<ReleaseSettings | null>(null);
  const [canManage, setCanManage] = React.useState(false);
  const [convention, setConvention] = React.useState("");
  const [repos, setRepos] = React.useState<Repository[]>([]);
  const [repoId, setRepoId] = React.useState<string | null>(null);
  const [repoConvention, setRepoConvention] = React.useState("");
  const [pipelines, setPipelines] = React.useState<Pipeline[] | null>(null);
  const [status, setStatus] = React.useState<"saving" | "saved" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    // Without the catalog (its code didn't load) the tag convention still shows; the per-repository part doesn't.
    const releases = host.releases().catch(() => null);
    Promise.all([host.projectSettings(), host.canManageProject(), releases, releases.then((c) => c?.repositories() ?? []).catch(() => [])]).then(([s, manage, c, all]) => {
      if (cancelled) return;
      setCatalog(c);
      setSettings(s.releases);
      setConvention(s.releases.tagConvention);
      setCanManage(manage);
      setRepos(all);
      setRepoId(all[0]?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [host]);

  React.useEffect(() => {
    if (!repoId || !settings || !catalog) return;
    setRepoConvention(settings.repos[repoId]?.tagConvention ?? "");
    setPipelines(null);
    let cancelled = false;
    catalog.pipelines(repoId).then(
      (list) => !cancelled && setPipelines(list),
      (e) => {
        console.warn("[review-deck] pipelines unavailable:", e);
        if (!cancelled) setPipelines([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [repoId, settings === null, catalog]);

  if (!settings) return null;

  const save = (releases: ReleaseSettings) => {
    setStatus("saving");
    setError(null);
    host.updateProjectSettings({ releases }).then(
      (next) => {
        setSettings(next.releases);
        setStatus("saved");
      },
      (e: Error) => {
        setStatus(null);
        setError(`Couldn't save: ${e.message}`);
      },
    );
  };
  const saveConvention = () => {
    const value = convention.trim() || DEFAULT_TAG_CONVENTION;
    setConvention(value);
    if (value !== settings.tagConvention) save({ ...settings, tagConvention: value });
  };
  const saveRepo = (change: Partial<RepoReleaseSettings>) => {
    if (!repoId) return;
    const repo: RepoReleaseSettings = { ...settings.repos[repoId], ...change };
    if (!repo.tagConvention) delete repo.tagConvention;
    if (repo.pipelineId === undefined) delete repo.pipelineId;
    const others = Object.fromEntries(Object.entries(settings.repos).filter(([id]) => id !== repoId));
    save({ ...settings, repos: Object.keys(repo).length ? { ...others, [repoId]: repo } : others });
  };
  const saveRepoConvention = () => {
    const value = repoConvention.trim();
    if (value !== (settings.repos[repoId!]?.tagConvention ?? "")) saveRepo({ tagConvention: value || undefined });
  };

  const repo = repos.find((r) => r.id === repoId);
  const pipelineId = repoId ? settings.repos[repoId]?.pipelineId : undefined;
  const pipeline = pipelines?.find((p) => p.id === pipelineId);

  return (
    <div className="release-settings">
      <div className="settings-field">
        <div className="settings-label-row">
          <span className="settings-label" id="tag-convention-label">
            Tag convention
          </span>
          <SaveStatus status={status} />
        </div>
        <p className="settings-help muted">
          The git tags the Changelog lists. <code>*</code> matches anything: <code>v*</code> matches <code>v1.2.0</code>,{" "}
          <code>release/*</code> matches <code>release/2026.10</code>. Tags with a semver are sorted by version.
        </p>
        <div className="release-settings-input">
          <TextField
            value={convention}
            placeholder={DEFAULT_TAG_CONVENTION}
            ariaLabel="Tag convention"
            readOnly={!canManage}
            onChange={(_, value) => setConvention(value)}
            onBlur={saveConvention}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveConvention();
            }}
          />
        </div>
      </div>

      {repo && (
        <div className="settings-field">
          <div className="settings-label-row">
            <span className="settings-label">Per repository</span>
            <DropdownButton
              icon="GitLogo"
              text={repo.name}
              ariaLabel="Repository"
              options={repos.map((r) => ({
                id: r.id,
                text: r.name,
                selected: r.id === repoId,
                secondaryText: settings.repos[r.id] ? "Customized" : undefined,
                onSelect: () => setRepoId(r.id),
              }))}
            />
          </div>
          <p className="settings-help muted">
            A tag is a Release when the latest run of the publishing pipeline on it succeeded with artifacts. With no publishing pipeline, a run of
            any pipeline counts.
          </p>
          <div className="release-settings-grid">
            <label htmlFor="repo-convention">Tag convention</label>
            <div className="release-settings-input">
              <TextField
                inputId="repo-convention"
                value={repoConvention}
                placeholder={`${settings.tagConvention} (the project's)`}
                readOnly={!canManage}
                onChange={(_, value) => setRepoConvention(value)}
                onBlur={saveRepoConvention}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveRepoConvention();
                }}
              />
            </div>
            <span id="publishing-pipeline-label">Publishing pipeline</span>
            <div>
              <DropdownButton
                text={pipelines === null ? "Loading…" : pipeline ? pipeline.name : pipelineId !== undefined ? `Pipeline ${pipelineId}` : "Any pipeline"}
                ariaLabel="Publishing pipeline"
                disabled={!canManage || pipelines === null}
                options={[
                  { id: "any", text: "Any pipeline", selected: pipelineId === undefined, onSelect: () => saveRepo({ pipelineId: undefined }) },
                  ...(pipelines?.length ? [{ id: "sep", text: "", divider: true }] : []),
                  ...(pipelines ?? []).map((p) => ({ id: String(p.id), text: p.name, selected: p.id === pipelineId, onSelect: () => saveRepo({ pipelineId: p.id }) })),
                ]}
              />
            </div>
          </div>
        </div>
      )}
      {!canManage && <p className="settings-help muted">Only project administrators can change these settings.</p>}
      {error && (
        <p className="settings-help tone-warning" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
