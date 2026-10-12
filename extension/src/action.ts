// "Open in semantic review" entry in the pull request action menu: navigates to the review hub
// with the PR and repository ids as query parameters.
import { CommonServiceIds, type IHostNavigationService } from "azure-devops-extension-api";
import * as SDK from "azure-devops-extension-sdk";

interface PrActionContext {
  pullRequest?: { pullRequestId: number; repository?: { id: string; project?: { name: string } } };
  pullRequestId?: number;
  repositoryId?: string;
}

SDK.register("open-review-action", {
  execute: async (context: PrActionContext) => {
    const prId = context.pullRequest?.pullRequestId ?? context.pullRequestId;
    const repoId = context.pullRequest?.repository?.id ?? context.repositoryId;
    if (!prId || !repoId) return;
    const ext = SDK.getExtensionContext();
    const project = SDK.getWebContext().project.name;
    const host = SDK.getHost();
    const nav = await SDK.getService<IHostNavigationService>(CommonServiceIds.HostNavigationService);
    const hub = `${ext.publisherId}.${ext.extensionId}.review-hub`;
    nav.navigate(
      `https://dev.azure.com/${host.name}/${encodeURIComponent(project)}/_apps/hub/${hub}?pr=${prId}&repo=${encodeURIComponent(repoId)}`,
    );
  },
});

SDK.init();
