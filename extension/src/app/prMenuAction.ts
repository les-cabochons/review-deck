import type { IHostNavigationService } from "azure-devops-extension-api";

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
      const prId = context.pullRequest?.pullRequestId ?? context.pullRequestId;
      const repoId = context.pullRequest?.repository?.id ?? context.repositoryId;
      if (!prId || !repoId) return;
      await sdk.ready();
      const ext = sdk.getExtensionContext();
      const project = context.pullRequest?.repository?.project?.name ?? sdk.getWebContext().project.name;
      const hub = `${ext.publisherId}.${ext.extensionId}.review-hub`;
      const query = new URLSearchParams({ pr: String(prId), repo: repoId });
      (await navigation()).navigate(
        `https://dev.azure.com/${encodeURIComponent(sdk.getHost().name)}/${encodeURIComponent(project)}/_apps/hub/${hub}?${query}`,
      );
    },
  };
}
