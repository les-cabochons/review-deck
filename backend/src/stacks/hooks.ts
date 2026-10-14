import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Azure DevOps service hooks -> restack jobs. The extension (a project admin turning auto-restack on)
 * subscribes two events to POST /api/hooks/ado?org=<organization> with an `X-Review-Deck-Hook` header:
 *   git.push                  a branch moved: restack the PRs that target it
 *   git.pullrequest.updated   a PR completed: restack the PRs on top of it onto where it merged
 * Hooks only say *that* something happened; the job re-reads everything from Azure DevOps.
 */
export const HOOK_HEADER = "x-review-deck-hook";

/** `extensionId`: the installed extension whose project settings apply (the hook URL's `ext`), if it said. */
export type JobBase = { organization: string; projectId: string; repositoryId: string; extensionId?: string };
export type RestackJob = JobBase & ({ kind: "push"; branch: string; oldTip: string; newTip: string } | { kind: "completed"; pullRequestId: number });

/** The per-organization secret the hook subscription sends: HMAC(HOOK_KEY, organization). */
export function hookSecret(key: string, organization: string): string {
  return createHmac("sha256", key).update(organization.toLowerCase()).digest("base64url");
}

export function verifyHookSecret(key: string, organization: string, presented: string): boolean {
  const expected = Buffer.from(hookSecret(key, organization));
  const actual = Buffer.from(presented);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

interface HookPayload {
  eventType?: string;
  resource?: {
    repository?: { id?: string; project?: { id?: string } };
    refUpdates?: { name?: string; oldObjectId?: string; newObjectId?: string }[];
    pullRequestId?: number;
    status?: string;
  };
  resourceContainers?: { project?: { id?: string } };
}

/** Restack jobs for one hook delivery; [] for events that don't concern stacks. */
export function jobsFromHook(organization: string, payload: unknown, extensionId?: string): RestackJob[] {
  const p = (payload ?? {}) as HookPayload;
  const repositoryId = p.resource?.repository?.id;
  const projectId = p.resource?.repository?.project?.id ?? p.resourceContainers?.project?.id;
  if (!repositoryId || !projectId) return [];
  const base: JobBase = { organization, projectId, repositoryId, ...(extensionId ? { extensionId } : {}) };
  if (p.eventType === "git.push") {
    return (p.resource?.refUpdates ?? [])
      .filter((u) => u.name?.startsWith("refs/heads/") && u.oldObjectId && u.newObjectId)
      .map((u) => ({ ...base, kind: "push" as const, branch: u.name!.slice("refs/heads/".length), oldTip: u.oldObjectId!, newTip: u.newObjectId! }));
  }
  if (p.eventType === "git.pullrequest.updated" && p.resource?.status === "completed" && typeof p.resource.pullRequestId === "number") {
    return [{ ...base, kind: "completed", pullRequestId: p.resource.pullRequestId }];
  }
  return [];
}
