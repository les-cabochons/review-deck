import { identityToken } from "../identity.js";

/** Azure DevOps' Entra resource ID: what a managed identity asks for to call dev.azure.com. */
const AZURE_DEVOPS_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";
const API_VERSION = "7.1";

export class AdoError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Azure DevOps REST calls as the restack service's own identity: the Function App's managed identity
 * (added to the organization as a user), or ADO_PAT for organizations where that isn't possible.
 */
export class AdoClient {
  readonly baseUrl: string;

  constructor(readonly organization: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/.test(organization)) throw new Error(`invalid organization name ${organization}`);
    this.baseUrl = `https://dev.azure.com/${organization}/`;
  }

  get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    return this.request<T>("GET", path, query);
  }

  post<T>(path: string, body: unknown, query: Record<string, string> = {}): Promise<T> {
    return this.request<T>("POST", path, query, body);
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", path, {}, body);
  }

  /** Absolute URL (another Azure DevOps host, such as extmgmt.dev.azure.com). */
  async request<T>(method: string, path: string, query: Record<string, string> = {}, body?: unknown): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries({ "api-version": API_VERSION, ...query })) url.searchParams.set(k, v);
    const response = await fetch(url, {
      method,
      headers: { authorization: await authorization(), accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const text = (await response.text()).slice(0, 300);
      throw new AdoError(response.status, `${method} ${url.pathname} returned ${response.status}: ${text}`);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  }
}

async function authorization(): Promise<string> {
  const pat = process.env.ADO_PAT;
  if (pat) return `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
  return `Bearer ${await identityToken(AZURE_DEVOPS_RESOURCE)}`;
}
