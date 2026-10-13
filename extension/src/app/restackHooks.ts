import type { BackendService } from "../review/backend";

/** The two events auto-restack needs (backend/src/stacks/hooks.ts). */
const EVENTS = [
  { eventType: "git.push", publisherInputs: { repository: "", branch: "" } },
  // StatusUpdateNotification: a PR was completed or abandoned.
  { eventType: "git.pullrequest.updated", publisherInputs: { repository: "", notificationType: "StatusUpdateNotification" } },
];

interface Subscription {
  id: string;
  eventType: string;
  publisherInputs?: { projectId?: string };
  consumerInputs?: { url?: string };
}

/**
 * Makes this project's service hook subscriptions match `on`: the backend gives the hook URL and the
 * organization's secret header, and the subscriptions are created as the signed-in project admin
 * (Azure DevOps requires "Edit subscriptions" on the project).
 */
export async function syncRestackHooks(context: { hostUrl: string; projectId: string; backend: BackendService; token: string }, on: boolean): Promise<void> {
  const { hostUrl, projectId, backend, token } = context;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${hostUrl}_apis/hooks/${path}${path.includes("?") ? "&" : "?"}api-version=7.1`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (response.status === 401 || response.status === 403) throw new Error("You need permission to edit service hook subscriptions in this project.");
    if (!response.ok) throw new Error(`Azure DevOps service hooks returned ${response.status}`);
    return (response.status === 204 ? undefined : await response.json()) as T;
  };

  const hook = await fetchHook(backend);
  const hookPath = hook.url.split("?")[0];
  const { value } = await call<{ value: Subscription[] }>("GET", "subscriptions?publisherId=tfs&consumerId=webHooks");
  const ours = value.filter((s) => s.publisherInputs?.projectId === projectId && s.consumerInputs?.url?.split("?")[0] === hookPath);
  // Recreate rather than patch: the secret header can't be read back to check it.
  for (const s of ours) await call("DELETE", `subscriptions/${s.id}`);
  if (!on) return;
  for (const event of EVENTS) {
    await call("POST", "subscriptions", {
      publisherId: "tfs",
      eventType: event.eventType,
      resourceVersion: "1.0",
      consumerId: "webHooks",
      consumerActionId: "httpRequest",
      publisherInputs: { projectId, ...event.publisherInputs },
      consumerInputs: { url: hook.url, httpHeaders: `${hook.header}: ${hook.secret}`, resourceDetailsToSend: "all", messagesToSend: "none", detailedMessagesToSend: "none" },
    });
  }
}

async function fetchHook(backend: BackendService): Promise<{ url: string; header: string; secret: string }> {
  const query = new URLSearchParams({ organization: backend.scope.organization });
  const response = await fetch(`${backend.url}/api/stacks/hook?${query}`, {
    headers: backend.token ? { authorization: `Bearer ${backend.token}` } : {},
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 503) throw new Error("The backend isn't set up for auto-restack yet (HOOK_KEY is missing).");
  if (!response.ok) throw new Error(`The backend returned ${response.status} when asked for the hook address.`);
  return (await response.json()) as { url: string; header: string; secret: string };
}
