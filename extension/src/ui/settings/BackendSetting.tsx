import { Button } from "azure-devops-ui/Button";
import { TextField, TextFieldWidth } from "azure-devops-ui/TextField";
import * as React from "react";
import { type AppHost, type BackendSettings, normalizeBackendUrl } from "../../app/host";
import { fetchUsage } from "../../review/backend";
import { SaveStatus } from "./SaveStatus";

/**
 * The organization's own backend (backend/, deployed by infra/): its URL and API key. Saved for the whole
 * organization, so only organization administrators can change it. Saving first checks that the backend
 * answers and accepts the key, so a typo can't silently turn the backend off for everyone.
 */
export const BackendSetting: React.FC<{ host: AppHost; /** After a save, so the other sections re-read the backend. */ onChange(): void }> = ({ host, onChange }) => {
  const [saved, setSaved] = React.useState<BackendSettings | null | undefined>(undefined);
  const [canManage, setCanManage] = React.useState(false);
  const [url, setUrl] = React.useState("");
  const [key, setKey] = React.useState("");
  const [status, setStatus] = React.useState<"saving" | "saved" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([host.backendSettings(), host.canManageOrganization()]).then(([settings, manage]) => {
      if (cancelled) return;
      setSaved(settings);
      setUrl(settings?.url ?? "");
      setKey(settings?.key ?? "");
      setCanManage(manage);
    });
    return () => {
      cancelled = true;
    };
  }, [host]);

  if (saved === undefined) return null;

  const store = async (settings: BackendSettings | null) => {
    await host.saveBackendSettings(settings);
    setSaved(settings);
    setStatus("saved");
    onChange();
  };

  const connect = async () => {
    setError(null);
    let settings: BackendSettings;
    try {
      settings = { url: normalizeBackendUrl(url), key: key.trim() };
    } catch (e) {
      setError(e instanceof TypeError ? "Enter the full URL, e.g. https://func-review-deck-abc123.azurewebsites.net" : (e as Error).message);
      return;
    }
    if (!settings.key) {
      setError("Enter the backend's API key (terraform output -raw api_key).");
      return;
    }
    setStatus("saving");
    try {
      await fetchUsage({ url: settings.url, token: settings.key, scope: { organization: "check", projectId: "check", projectName: "check" } });
    } catch (e) {
      setStatus(null);
      setError(connectError(e as Error));
      return;
    }
    try {
      await store(settings);
      setUrl(settings.url);
    } catch (e) {
      setStatus(null);
      setError(`Couldn't save: ${(e as Error).message}`);
    }
  };

  const disconnect = () => {
    setError(null);
    setStatus("saving");
    store(null).then(
      () => {
        setUrl("");
        setKey("");
      },
      (e: Error) => {
        setStatus(null);
        setError(`Couldn't save: ${e.message}`);
      },
    );
  };

  const changed = url.trim() !== (saved?.url ?? "") || key.trim() !== (saved?.key ?? "");

  return (
    <div className="backend-settings">
      <p className="settings-help muted">
        Optional. A backend you deploy in your own Azure subscription (see the README) adds embeddings for better grouping, AI group
        titles and auto-restack. It's shared by every project in this organization.
      </p>
      <p className="settings-help">{describe(saved)}</p>
      {canManage ? (
        <>
          <div className="settings-field">
            <div className="settings-label-row">
              <label className="settings-label" htmlFor="backend-url">
                Backend URL
              </label>
              <SaveStatus status={status} />
            </div>
            <TextField
              inputId="backend-url"
              value={url}
              placeholder="https://func-review-deck-abc123.azurewebsites.net"
              width={TextFieldWidth.auto}
              onChange={(_, value) => setUrl(value)}
            />
          </div>
          <div className="settings-field">
            <label className="settings-label" htmlFor="backend-key">
              API key
            </label>
            <TextField inputId="backend-key" inputType="password" value={key} width={TextFieldWidth.auto} onChange={(_, value) => setKey(value)} />
            <p className="settings-help muted">
              From <code>terraform -chdir=infra output -raw api_key</code>. Everyone in the organization can read it, since their
              browsers send it with each request.
            </p>
          </div>
          <div className="backend-actions">
            <Button primary text={saved ? "Check and save" : "Connect"} disabled={!changed || status === "saving"} onClick={() => void connect()} />
            {saved && <Button text="Disconnect" disabled={status === "saving"} onClick={disconnect} />}
          </div>
        </>
      ) : (
        <p className="settings-help muted">Only organization administrators can change the backend.</p>
      )}
      {error && (
        <p className="settings-help tone-warning" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

function describe(saved: BackendSettings | null): string {
  if (saved) return `Connected to ${new URL(saved.url).host}.`;
  return "No backend: hunks are grouped by code structure in the browser, and groups get rule-based titles.";
}

function connectError(e: Error): string {
  if (/ 401\b/.test(e.message)) return "The backend rejected the API key.";
  if (/ \d{3}\b/.test(e.message)) return `The backend answered, but not as expected (${e.message}).`;
  return `Couldn't reach the backend. Check the URL, and that its allowed_origins (CORS) include ${location.origin}.`;
}
