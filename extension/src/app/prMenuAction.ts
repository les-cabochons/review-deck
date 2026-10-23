import type { IHostNavigationService } from "azure-devops-extension-api";
import { reviewHubUrl } from "./hashRoute";
import type { Route } from "./host";

/** What the pull request menu passes to execute; Azure DevOps' PR pages don't all pass the same shape. */
export interface PrActionContext {
  pullRequest?: { pullRequestId: number; repository?: { id: string; project?: { name: string } } };
  pullRequestId?: number;
  repositoryId?: string;
}

/** The parts of azure-devops-extension-sdk the action uses. */
export interface ActionSdk {
  ready(): Promise<void>;
  getHost(): { name: string };
  getExtensionContext(): { publisherId: string; extensionId: string };
  getWebContext(): { project: { name: string } };
}

/**
 * "Open in Review Deck" in the pull request menu: opens the PR in the Deck hub. Azure DevOps loads the action's hidden
 * frame on the first click and can call execute before it has answered the frame's handshake, while the SDK's
 * context getters still throw; the first click then did nothing, and only the second opened the review.
 */
export function openReviewAction(sdk: ActionSdk, navigation: () => Promise<Pick<IHostNavigationService, "navigate">>) {
  return {
    execute: async (context: PrActionContext) => {
      const route = prRoute(context);
      if (!route) return;
      await sdk.ready();
      const project = route.project ?? sdk.getWebContext().project.name;
      (await navigation()).navigate(reviewHubUrl(sdk.getHost().name, sdk.getExtensionContext(), project, route));
    },
  };
}

/** `ask`'s answer, asked for once and kept for every later call; asked again if it failed. */
export function keptUnlessFailed<T>(ask: () => Promise<T>): () => Promise<T> {
  let kept: Promise<T> | null = null;
  return () => {
    if (!kept) {
      const asked = ask();
      asked.catch(() => {
        if (kept === asked) kept = null;
      });
      kept = asked;
    }
    return kept;
  };
}

function prRoute(context: PrActionContext): Extract<Route, { view: "pr" }> | null {
  const pr = context.pullRequest?.pullRequestId ?? context.pullRequestId;
  const repo = context.pullRequest?.repository?.id ?? context.repositoryId;
  return pr && repo ? { view: "pr", pr, repo, project: context.pullRequest?.repository?.project?.name } : null;
}
