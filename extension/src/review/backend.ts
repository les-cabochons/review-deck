import type { Embedder } from "../../../src/score/index";
import { type LlmTitle, matchTitles, type PromptContext, promptGroups } from "../../../src/title/prompt";
import type { GroupTitle, TitleInput, Titler } from "../../../src/title/types";
import type { RestackOutcome } from "../../../src/stack/restack";

/** The Azure Function (backend/, deployed by infra/) and a token it accepts. */
export interface BackendService {
  /** Function App base URL, without /api. */
  url: string;
  /** Azure DevOps app token (SDK.getAppToken()); empty against a local `func start`. */
  token: string;
  /** Which organization and project LLM spend counts against (backend/src/budget.ts). */
  scope: Scope;
}

export interface Scope {
  organization: string;
  projectId: string;
  projectName: string;
}

/** The backend's titles model and this month's spend against the caps, in USD (GET /api/usage). */
export interface Usage {
  /** Deployment name, e.g. "gpt-5-nano"; null when the backend has no model (titles unavailable). */
  model: string | null;
  organization: { spentUsd: number; capUsd: number };
  project: { spentUsd: number; capUsd: number };
}

/** Limits enforced by backend/src/index.ts and titles.ts; applied here too, to skip a request bound to fail. */
const MAX_TEXTS = 2000;
const MAX_CHARS = 1500;
const MAX_TITLED_GROUPS = 40;
const MAX_TITLED_HUNKS = 200;
/** Long enough for a cold start plus a large PR; after that, grouping goes on without embeddings. */
const TIMEOUT_MS = 45_000;
/** The model usually answers in a few seconds; past this, the heuristic titles stay. */
const TITLES_TIMEOUT_MS = 30_000;

/** Embeds hunk texts with the Azure Function. Any failure throws, and the pipeline drops the semantic signal. */
export class RemoteEmbedder implements Embedder {
  constructor(private readonly service: BackendService) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length > MAX_TEXTS) throw new Error(`${texts.length} hunks is more than the embedding service accepts (${MAX_TEXTS})`);
    const response = await fetch(`${this.service.url}/api/embed`, {
      method: "POST",
      headers: { ...authorization(this.service), "content-type": "application/json" },
      body: JSON.stringify({ texts: texts.map((t) => t.slice(0, MAX_CHARS)) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`embedding service returned ${response.status}`);
    const { vectors } = (await response.json()) as { vectors?: unknown };
    if (!Array.isArray(vectors) || vectors.length !== texts.length) throw new Error("embedding service returned an unexpected response");
    return vectors as number[][];
  }
}

/**
 * Titles groups with the backend's small hosted model (titles_model). Any failure throws, and the pipeline
 * keeps heuristic titles; groups past the request limits, or skipped by the model, keep theirs too.
 */
export class RemoteTitler implements Titler {
  readonly name = "llm:backend";

  constructor(private readonly service: BackendService) {}

  async title(inputs: TitleInput[], context: PromptContext): Promise<GroupTitle[]> {
    const groups = promptGroups(inputs.slice(0, MAX_TITLED_GROUPS));
    const perGroup = Math.max(1, Math.floor(MAX_TITLED_HUNKS / groups.length));
    for (const g of groups) g.hunks = g.hunks.slice(0, perGroup);
    const response = await fetch(`${this.service.url}/api/titles`, {
      method: "POST",
      headers: { ...authorization(this.service), "content-type": "application/json" },
      body: JSON.stringify({ scope: this.service.scope, context, groups }),
      signal: AbortSignal.timeout(TITLES_TIMEOUT_MS),
    });
    // 429 = a spending cap was reached; the message says which.
    if (!response.ok) throw new Error(`titles service returned ${response.status}: ${await errorMessage(response)}`);
    const { titles } = (await response.json()) as { titles?: LlmTitle[] };
    if (!Array.isArray(titles)) throw new Error("titles service returned an unexpected response");
    return matchTitles(inputs, titles);
  }
}

export async function fetchUsage(service: BackendService): Promise<Usage> {
  const query = new URLSearchParams({ ...service.scope });
  const response = await fetch(`${service.url}/api/usage?${query}`, { headers: authorization(service), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`usage service returned ${response.status}`);
  return (await response.json()) as Usage;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    return String(((await response.json()) as { error?: unknown }).error ?? "");
  } catch {
    return "";
  }
}

export type { RestackOutcome };

/**
 * Asks the backend to restack one PR now (POST /api/stacks/restack). `adoToken` is the user's Azure DevOps
 * token: the backend checks it can read the PR. Rejects with the backend's message.
 */
export async function restackPr(
  service: BackendService,
  request: { projectId: string; repositoryId: string; pullRequestId: number; extensionId: string; adoToken: string },
): Promise<RestackOutcome[]> {
  const response = await fetch(`${service.url}/api/stacks/restack`, {
    method: "POST",
    headers: { ...authorization(service), "content-type": "application/json" },
    body: JSON.stringify({ organization: service.scope.organization, ...request }),
    // Cherry-picks run on the server and can take a minute on a deep stack.
    signal: AbortSignal.timeout(200_000),
  });
  if (response.status === 404) throw new Error("This backend doesn't support restacking on request yet. Redeploy it.");
  if (!response.ok) throw new Error((await errorMessage(response)) || `The backend returned ${response.status}.`);
  const { outcomes } = (await response.json()) as { outcomes?: RestackOutcome[] };
  return outcomes ?? [];
}

/** Starts the function's cold start (instance + model load) while the page is still fetching files. */
export function warmBackend(service: BackendService): void {
  fetch(`${service.url}/api/warm`, { headers: authorization(service) }).catch(() => {});
}

function authorization(service: BackendService): Record<string, string> {
  return service.token ? { authorization: `Bearer ${service.token}` } : {};
}
