// Spending caps for LLM titles: a daily cap for the whole backend, and monthly caps per organization and
// per project (UTC days and months). Spend is tracked in the `usage` table.
import { table } from "./storage.js";

/** Who a request is for, as the page reports it (see Scope in extension/src/review/backend.ts). */
export interface Scope {
  organization: string;
  projectId: string;
  projectName: string;
}

/**
 * TITLES_CAPS, from Terraform's `titles_caps` (snake_case, as written there). Org and project keys are
 * names (case-insensitive); a project can also be keyed by its ID.
 */
interface CapsConfig {
  org_monthly_usd: number;
  project_monthly_usd: number;
  orgs: Record<string, { monthly_usd?: number | null; project_monthly_usd?: number | null; projects?: Record<string, number> | null }>;
}

export interface Limit {
  /** For messages: "organization cabochons", "project Semantic_pr", "backend". */
  label: string;
  period: "day" | "month";
  partition: string;
  row: string;
  capUsd: number;
}

export interface Spend {
  spentUsd: number;
  capUsd: number;
}

export class BudgetExceeded extends Error {}

const DAILY_CAP_USD = Number(process.env.TITLES_DAILY_BUDGET_USD ?? 0.025);
const CAPS: CapsConfig = { org_monthly_usd: 0.5, project_monthly_usd: 0.25, orgs: {}, ...JSON.parse(process.env.TITLES_CAPS || "{}") };

/** The three limits a request counts against, tightest scope last. */
export function limitsFor(scope: Scope, now = new Date()): Limit[] {
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const org = lookup(CAPS.orgs, scope.organization);
  const projectCap =
    lookup(org?.projects ?? {}, scope.projectName) ?? lookup(org?.projects ?? {}, scope.projectId) ?? org?.project_monthly_usd ?? CAPS.project_monthly_usd;
  const orgKey = key(scope.organization.toLowerCase());
  return [
    { label: "backend", period: "day", partition: "backend", row: day, capUsd: DAILY_CAP_USD },
    { label: `organization ${scope.organization}`, period: "month", partition: `org:${orgKey}`, row: month, capUsd: org?.monthly_usd ?? CAPS.org_monthly_usd },
    { label: `project ${scope.projectName}`, period: "month", partition: `project:${orgKey}:${key(scope.projectId)}`, row: month, capUsd: projectCap },
  ];
}

/** Throws BudgetExceeded for the first limit already spent. A call is allowed while under every cap, so it can overshoot by one call. */
export async function checkLimits(limits: Limit[]): Promise<void> {
  const spent = await Promise.all(limits.map(read));
  limits.forEach((limit, i) => {
    if (spent[i] >= limit.capUsd) {
      throw new BudgetExceeded(`${limit.period === "day" ? "daily" : "monthly"} AI title budget for ${limit.label} reached ($${limit.capUsd})`);
    }
  });
}

export async function recordSpend(limits: Limit[], usd: number): Promise<void> {
  await Promise.all(limits.map((limit) => add(limit, usd)));
}

/** This month's spend and caps for the organization and project, for the hub's settings. */
export async function usage(scope: Scope): Promise<{ organization: Spend; project: Spend }> {
  const [, org, project] = limitsFor(scope);
  return {
    organization: { spentUsd: await read(org), capUsd: org.capUsd },
    project: { spentUsd: await read(project), capUsd: project.capUsd },
  };
}

async function read(limit: Limit): Promise<number> {
  const row = await (await table("usage")).getEntity<{ usd: number }>(limit.partition, limit.row).catch(() => null);
  return row?.usd ?? 0;
}

/** Adds to a period's spend; the ETag check retries if two requests update the row at once. */
async function add(limit: Limit, usd: number): Promise<void> {
  const usage = await table("usage");
  const entity = { partitionKey: limit.partition, rowKey: limit.row };
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await usage.getEntity<{ usd: number }>(limit.partition, limit.row).catch(() => null);
    try {
      if (row) await usage.updateEntity({ ...entity, usd: row.usd + usd }, "Replace", { etag: row.etag });
      else await usage.createEntity({ ...entity, usd });
      return;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status !== 409 && status !== 412) throw e;
    }
  }
}

function lookup<T>(map: Record<string, T>, name: string): T | undefined {
  const lower = name.toLowerCase();
  const found = Object.entries(map).find(([k]) => k.toLowerCase() === lower);
  return found?.[1] ?? undefined;
}

/** Table keys can't contain / \ # ? or control characters; percent-encoding removes all of them. */
function key(value: string): string {
  return encodeURIComponent(value);
}
