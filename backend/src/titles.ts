// Group titles from a small hosted model (gpt-5-nano on Azure OpenAI), with two cost guards: identical
// prompts are answered from a Table storage cache, and spending caps (budget.ts) stop calls.
import { createHash } from "node:crypto";
import { buildPrompt, type LlmTitle, parseTitles, type PromptContext, type PromptGroup } from "../../src/title/prompt.js";
import { checkLimits, limitsFor, recordSpend, type Scope } from "./budget.js";
import { table } from "./storage.js";

/** Request bounds: the page's prompt budget (~160 lines) fits well inside them. */
const MAX_GROUPS = 40;
const MAX_HUNKS = 200;
const MAX_LINES_PER_HUNK = 40;
const MAX_LINE_CHARS = 200;
const MAX_PROMPT_CHARS = 32_000;
/** Visible answer + the reasoning tokens gpt-5 models spend first; both are billed as output. */
const MAX_OUTPUT_TOKENS = 2000;

const settings = {
  /** Azure OpenAI resource endpoint, e.g. https://oai-semantic-pr-abc123.openai.azure.com/ */
  endpoint: process.env.OPENAI_ENDPOINT ?? "",
  deployment: process.env.OPENAI_DEPLOYMENT ?? "gpt-5-nano",
  /** Local development only; deployed apps use their managed identity (the resource has keys disabled). */
  apiKey: process.env.OPENAI_API_KEY ?? "",
  inputPerMillion: Number(process.env.TITLES_PRICE_INPUT_PER_M ?? 0.05),
  outputPerMillion: Number(process.env.TITLES_PRICE_OUTPUT_PER_M ?? 0.4),
};

export class BadRequest extends Error {}

export interface TitlesRequest {
  scope: Scope;
  context: PromptContext;
  groups: PromptGroup[];
}

export async function titleGroups(body: unknown, log: (message: string) => void): Promise<{ titles: LlmTitle[]; cached: boolean }> {
  const [groups, context, scope] = validate(body);
  const prompt = buildPrompt(groups, context);
  if (prompt.length > MAX_PROMPT_CHARS) throw new BadRequest("prompt too large");
  // Per organization, so one organization's cached answers are never served to another.
  const key = createHash("sha256").update(`${settings.deployment}\n${scope.organization.toLowerCase()}\n${prompt}`).digest("hex");

  const cache = await table("titles");
  const hit = await cache.getEntity<{ titles: string }>(key.slice(0, 2), key).catch(() => null);
  if (hit) return { titles: JSON.parse(hit.titles), cached: true };

  const limits = limitsFor(scope);
  await checkLimits(limits);
  const { text, inputTokens, outputTokens } = await complete(prompt);
  const cost = (inputTokens * settings.inputPerMillion + outputTokens * settings.outputPerMillion) / 1e6;
  await recordSpend(limits, cost);
  log(`titled ${scope.organization}/${scope.projectName}, ${prompt.length} chars: ${inputTokens} in / ${outputTokens} out tokens, $${cost.toFixed(6)}`);

  const titles = parseTitles(text);
  await cache.upsertEntity({ partitionKey: key.slice(0, 2), rowKey: key, titles: JSON.stringify(titles) });
  return { titles, cached: false };
}

/** Keeps only the fields the prompt and budget use, clipped to the request bounds. */
function validate(body: unknown): [PromptGroup[], PromptContext, Scope] {
  const b = body as Partial<TitlesRequest> | null;
  if (!b || !Array.isArray(b.groups) || typeof b.context !== "object" || b.context === null) throw new BadRequest("expected {context, groups}");
  if (b.groups.length === 0 || b.groups.length > MAX_GROUPS) throw new BadRequest(`expected 1-${MAX_GROUPS} groups`);
  const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);
  let hunkCount = 0;
  const groups = b.groups.map((g): PromptGroup => {
    if (!Array.isArray(g?.hunks)) throw new BadRequest("each group needs hunks");
    hunkCount += g.hunks.length;
    return {
      id: clip(g.id, 40),
      hunks: g.hunks.map((h) => ({
        id: clip(h?.id, 200),
        symbol: h?.symbol ? clip(h.symbol, 120) : null,
        changed: (Array.isArray(h?.changed) ? h.changed : []).slice(0, MAX_LINES_PER_HUNK).map((l) => clip(l, MAX_LINE_CHARS)),
      })),
    };
  });
  if (hunkCount > MAX_HUNKS) throw new BadRequest(`at most ${MAX_HUNKS} hunks`);
  return [groups, { prTitle: clip(b.context.prTitle, 300), prDescription: clip(b.context.prDescription, 2000) }, parseScope(b.scope)];
}

export function parseScope(value: unknown): Scope {
  const s = value as Partial<Record<keyof Scope, unknown>> | null | undefined;
  const clip = (v: unknown) => String(v ?? "").slice(0, 100);
  const scope = { organization: clip(s?.organization), projectId: clip(s?.projectId), projectName: clip(s?.projectName) };
  if (!scope.organization || !scope.projectId || !scope.projectName) throw new BadRequest("expected scope {organization, projectId, projectName}");
  return scope;
}

async function complete(prompt: string): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  if (!settings.endpoint) throw new Error("OPENAI_ENDPOINT is not set");
  const auth: Record<string, string> = settings.apiKey ? { "api-key": settings.apiKey } : { authorization: `Bearer ${await identityToken()}` };
  const response = await fetch(new URL("openai/v1/chat/completions", settings.endpoint), {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      model: settings.deployment,
      messages: [{ role: "user", content: prompt }],
      reasoning_effort: "minimal",
      max_completion_tokens: MAX_OUTPUT_TOKENS,
    }),
    signal: AbortSignal.timeout(40_000),
  });
  if (!response.ok) throw new Error(`model returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    inputTokens: data.usage?.prompt_tokens ?? 0,
    // Unknown usage is charged as the maximum, so the budget errs on the safe side.
    outputTokens: data.usage?.completion_tokens ?? MAX_OUTPUT_TOKENS,
  };
}

let token: { value: string; expiresAt: number } | null = null;

/** A token for Azure OpenAI from the Function App's managed identity (App Service identity endpoint). */
async function identityToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 5 * 60_000) return token.value;
  const { IDENTITY_ENDPOINT: endpoint, IDENTITY_HEADER: header } = process.env;
  if (!endpoint || !header) throw new Error("no managed identity; set OPENAI_API_KEY for local runs");
  const url = `${endpoint}?resource=${encodeURIComponent("https://cognitiveservices.azure.com")}&api-version=2019-08-01`;
  const response = await fetch(url, { headers: { "X-IDENTITY-HEADER": header } });
  if (!response.ok) throw new Error(`managed identity returned ${response.status}`);
  const data = (await response.json()) as { access_token: string; expires_on: string };
  token = { value: data.access_token, expiresAt: Number(data.expires_on) * 1000 };
  return token.value;
}
