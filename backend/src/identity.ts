const tokens = new Map<string, { value: string; expiresAt: number }>();

/** A token for `resource` from the Function App's managed identity (App Service identity endpoint). */
export async function identityToken(resource: string): Promise<string> {
  const cached = tokens.get(resource);
  if (cached && cached.expiresAt > Date.now() + 5 * 60_000) return cached.value;
  const { IDENTITY_ENDPOINT: endpoint, IDENTITY_HEADER: header } = process.env;
  if (!endpoint || !header) throw new Error(`no managed identity for ${resource}`);
  const url = `${endpoint}?resource=${encodeURIComponent(resource)}&api-version=2019-08-01`;
  const response = await fetch(url, { headers: { "X-IDENTITY-HEADER": header } });
  if (!response.ok) throw new Error(`managed identity returned ${response.status}`);
  const data = (await response.json()) as { access_token: string; expires_on: string };
  tokens.set(resource, { value: data.access_token, expiresAt: Number(data.expires_on) * 1000 });
  return data.access_token;
}
