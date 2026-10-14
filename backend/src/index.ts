// Azure Function backing the review page:
//   POST /api/embed   {"texts": string[]}  ->  {"model": string, "vectors": number[][]}  (semantic grouping signal)
//   POST /api/titles  {"scope", "context", "groups"} -> {"titles": [{id, title, rationale}]}  (group titles, titles_model)
//   GET  /api/usage?organization=&projectId=&projectName=  ->  the titles model (or null) and this month's spend and caps
//   GET  /api/warm    loads the embedding model; the page calls it first so the cold start overlaps blob fetching.
//   GET  /api/stacks/hook?organization=  ->  {url, header, secret} for the auto-restack service hooks
//   POST /api/hooks/ado?org=&ext=  Azure DevOps service hook (git.push, git.pullrequest.updated) -> restack queue
//   POST /api/stacks/restack  {organization, projectId, repositoryId, pullRequestId, extensionId, adoToken} -> {outcomes, log}
//   queue "restack"   runs restack jobs one at a time (src/stack/restack.ts)
import { app, type HttpRequest, type HttpResponseInit, output } from "@azure/functions";
import { verifyApiKey } from "./auth.js";
import { embed, MODEL, warm } from "./embed.js";
import { BudgetExceeded, usage } from "./budget.js";
import { BadRequest, parseScope, titleGroups, titlesConfigured, titlesModel } from "./titles.js";
import { HOOK_HEADER, hookSecret, jobsFromHook, type RestackJob, verifyHookSecret } from "./stacks/hooks.js";
import { ManualRestackError, runManualRestack, runRestackJob } from "./stacks/run.js";
import { AdoError } from "./stacks/ado.js";
import { parseExtensionId } from "./stacks/settings.js";

/** Bounds per request, so one call can't run for minutes. Bigger PRs fall back to structural grouping. */
const MAX_TEXTS = 2000;
/** MiniLM reads at most 256 tokens, roughly this many characters of code. */
const MAX_CHARS = 1500;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** The key organizations save with this backend's URL in Project settings → Review Deck. */
const apiKey = process.env.API_KEY ?? "";
const development = process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development";

function authorized(request: HttpRequest): boolean {
  // Local `func start` without a key accepts anything; a deployed app without one accepts nothing.
  if (!apiKey) return development;
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") && verifyApiKey(header.slice(7), apiKey);
}

const error = (status: number, message: string): HttpResponseInit => ({ status, jsonBody: { error: message } });

app.http("warm", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request) => {
    if (!authorized(request)) return error(401, "invalid token");
    await warm();
    return { status: 204 };
  },
});

app.http("embed", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    if (!authorized(request)) return error(401, "invalid token");
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return error(413, "body too large");
    let texts: unknown;
    try {
      texts = ((await request.json()) as { texts?: unknown }).texts;
    } catch {
      return error(400, "expected JSON");
    }
    if (!Array.isArray(texts) || !texts.every((t) => typeof t === "string")) return error(400, "expected {texts: string[]}");
    if (texts.length > MAX_TEXTS) return error(413, `at most ${MAX_TEXTS} texts per request`);
    const started = Date.now();
    const vectors = await embed(texts.map((t) => t.slice(0, MAX_CHARS)));
    context.log(`embedded ${texts.length} texts in ${Date.now() - started}ms`);
    return { jsonBody: { model: MODEL, vectors } };
  },
});

app.http("titles", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    if (!authorized(request)) return error(401, "invalid token");
    if (!titlesConfigured) return error(503, "AI titles aren't set up on this backend");
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return error(413, "body too large");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return error(400, "expected JSON");
    }
    try {
      return { jsonBody: await titleGroups(body, (m) => context.log(m)) };
    } catch (e) {
      if (e instanceof BadRequest) return error(400, e.message);
      if (e instanceof BudgetExceeded) return error(429, e.message);
      context.error(e);
      return error(502, "titles unavailable");
    }
  },
});

app.http("usage", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    if (!authorized(request)) return error(401, "invalid token");
    try {
      const q = request.query;
      const scope = parseScope({ organization: q.get("organization"), projectId: q.get("projectId"), projectName: q.get("projectName") });
      return { jsonBody: { model: titlesModel, ...(await usage(scope)) } };
    } catch (e) {
      if (e instanceof BadRequest) return error(400, e.message);
      context.error(e);
      return error(502, "usage unavailable");
    }
  },
});

// ---------- auto-restack ----------

const hookKey = process.env.HOOK_KEY ?? "";
const restackQueue = output.storageQueue({ queueName: "restack", connection: "AzureWebJobsStorage" });
const ORGANIZATION = /^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/;

/** Where and how the extension subscribes the service hooks; called when a project admin turns auto-restack on. */
app.http("stackHook", {
  route: "stacks/hook",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request) => {
    if (!authorized(request)) return error(401, "invalid token");
    if (!hookKey) return error(503, "auto-restack isn't configured on this backend (HOOK_KEY)");
    const organization = request.query.get("organization") ?? "";
    if (!ORGANIZATION.test(organization)) return error(400, "expected ?organization=");
    const extension = parseExtensionId(request.query.get("extension"));
    const query = new URLSearchParams({ org: organization, ...(extension ? { ext: extension } : {}) });
    const url = new URL(`/api/hooks/ado?${query}`, request.url).toString();
    return { jsonBody: { url, header: HOOK_HEADER, secret: hookSecret(hookKey, organization) } };
  },
});

app.http("adoHook", {
  route: "hooks/ado",
  methods: ["POST"],
  authLevel: "anonymous",
  extraOutputs: [restackQueue],
  handler: async (request, context) => {
    const organization = request.query.get("org") ?? "";
    if (!hookKey || !ORGANIZATION.test(organization) || !verifyHookSecret(hookKey, organization, request.headers.get(HOOK_HEADER) ?? "")) {
      return error(401, "invalid hook secret");
    }
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return error(413, "body too large");
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return error(400, "expected JSON");
    }
    const jobs = jobsFromHook(organization, payload, parseExtensionId(request.query.get("ext")));
    if (jobs.length) context.extraOutputs.set(restackQueue, jobs);
    context.log(`hook from ${organization}: ${jobs.length} restack job(s)`);
    // Reply fast: Azure DevOps retries slow hooks, and restacking can take a while.
    return { status: 202 };
  },
});

/**
 * Restacks one PR now, as the restack identity, and answers with what happened. The caller passes its
 * own Azure DevOps token: it must be able to read the PR, so the backend key alone can't restack anything.
 */
app.http("stackRestack", {
  route: "stacks/restack",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    if (!authorized(request)) return error(401, "invalid token");
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return error(400, "expected JSON");
    }
    const { organization, projectId, repositoryId, pullRequestId, extensionId, adoToken } = body ?? {};
    if (
      typeof organization !== "string" || !ORGANIZATION.test(organization) ||
      typeof projectId !== "string" || !projectId || typeof repositoryId !== "string" || !repositoryId ||
      typeof pullRequestId !== "number" || !Number.isSafeInteger(pullRequestId) ||
      typeof adoToken !== "string" || !adoToken ||
      (extensionId !== undefined && !parseExtensionId(extensionId))
    ) {
      return error(400, "expected {organization, projectId, repositoryId, pullRequestId, adoToken, extensionId?}");
    }
    const prUrl = `https://dev.azure.com/${organization}/${encodeURIComponent(projectId)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullrequests/${pullRequestId}?api-version=7.1`;
    const visible = await fetch(prUrl, { headers: { authorization: `Bearer ${adoToken}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!visible?.ok) return error(403, "you can't read this pull request");
    const log: string[] = [];
    try {
      const outcomes = await runManualRestack({ organization, projectId, repositoryId, pullRequestId, extensionId: parseExtensionId(extensionId) }, (m) => {
        log.push(m);
        context.log(m);
      });
      context.log(`manual restack of !${pullRequestId} in ${organization}: ${JSON.stringify(outcomes)}`);
      return { jsonBody: { outcomes, log } };
    } catch (e) {
      if (e instanceof ManualRestackError) return error(409, e.message);
      context.error(`manual restack of !${pullRequestId} in ${organization} failed`, e);
      // The restack identity's own errors (not added to the organization, missing permissions) are what admins need to see.
      if (e instanceof AdoError) return error(502, `Azure DevOps refused the restack service: ${e.message}`);
      return error(500, `restack failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
});

app.storageQueue("restack", {
  queueName: "restack",
  connection: "AzureWebJobsStorage",
  handler: async (message, context) => {
    const job = message as RestackJob;
    try {
      const outcomes = await runRestackJob(job, (m) => context.log(m));
      context.log(`restack ${job.kind} in ${job.organization}: ${JSON.stringify(outcomes)}`);
    } catch (e) {
      // No retry storm: the next push or completion triggers a fresh job anyway.
      context.error(`restack ${job.kind} in ${job.organization} failed`, e);
    }
  },
});
