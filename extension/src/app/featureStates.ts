import { getClient } from "azure-devops-extension-api";
import { ContributedFeatureEnabledValue, type ContributedFeatureState, FeatureManagementRestClient } from "azure-devops-extension-api/FeatureManagement";
import { defaultOn, enabledFor, type Feature, type FeaturePolicy, VisibilityNotSynced } from "../data/access";

/** Parallel requests when setting every project's state. */
const CONCURRENCY = 6;

/** The manifest's ms.vss-web.feature contribution that the feature's hub and menu entries are constrained on. */
export function featureContributionId(extensionId: string, feature: Feature): string {
  return `${extensionId}.${feature}-feature`;
}

/**
 * Writes the policy into Azure DevOps feature management, which shows or hides the hub: each given project's state,
 * set explicitly so it doesn't depend on how Azure DevOps inherits, and with `organization` the organization's
 * too, for projects created later. Only organization administrators may write that one, so a project's own change
 * leaves it alone. Extension data stays the source of truth; this only mirrors it.
 */
export async function syncFeatureStates(featureId: string, policy: FeaturePolicy, projectIds: string[], organization: boolean): Promise<void> {
  const client = getClient(FeatureManagementRestClient);
  const state = (on: boolean, settingScope: string): ContributedFeatureState => ({
    featureId,
    state: on ? ContributedFeatureEnabledValue.Enabled : ContributedFeatureEnabledValue.Disabled,
    scope: { settingScope, userScoped: false },
    overridden: false,
    reason: "Review Deck settings",
  });
  try {
    if (organization) await client.setFeatureState(state(defaultOn(policy), ""), featureId, "host");
    const queue = [...projectIds];
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        await client.setFeatureStateForScope(state(enabledFor(policy, id), "project"), featureId, "host", "project", id);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, projectIds.length) }, worker));
  } catch (e) {
    throw new VisibilityNotSynced(`Saved, but Azure DevOps didn't update which projects show the hub: ${(e as Error).message}`);
  }
}
