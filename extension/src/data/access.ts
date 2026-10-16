/**
 * Which projects get the Deck and Changelog hubs, and whether AI group titles are allowed at all: the
 * organization's choices, set in Organization settings → Review Deck. Project settings → Review Deck lets a
 * project administrator switch a feature for their project, unless the organization set it for every project.
 */

/** The hubs an organization can turn on or off per project (manifest contributions "deck-feature", "changelog-feature"). */
export type Feature = "deck" | "changelog";
export const FEATURES: readonly Feature[] = ["deck", "changelog"];

export const FEATURE_NAMES: Record<Feature, string> = { deck: "Deck", changelog: "Changelog" };

/**
 * "on" / "off": the same for every project, and projects can't change it. "default-on" / "default-off": projects
 * start there and their administrators (or the organization's) can switch it for one project.
 */
export type FeatureMode = "on" | "off" | "default-on" | "default-off";

export interface FeaturePolicy {
  mode: FeatureMode;
  /** Projects (by id) switched away from the default. Ignored while the mode is "on" or "off", but kept for when it changes back. */
  projects: Record<string, boolean>;
}

export interface OrganizationSettings {
  deck: FeaturePolicy;
  changelog: FeaturePolicy;
  /** Projects may turn on AI group titles. Off overrides every project's choice. */
  aiTitles: boolean;
}

/** Before an administrator chooses, everything is available, as it was before these settings existed. */
export const DEFAULT_ORGANIZATION_SETTINGS: OrganizationSettings = {
  deck: { mode: "default-on", projects: {} },
  changelog: { mode: "default-on", projects: {} },
  aiTitles: true,
};

/** In the order the organization's settings page offers them. */
export const FEATURE_MODES: readonly FeatureMode[] = ["default-on", "default-off", "on", "off"];

/** Settings from storage, with anything missing or malformed at its default. */
export function readOrganizationSettings(saved: unknown): OrganizationSettings {
  const s = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
  return {
    deck: readPolicy(s.deck),
    changelog: readPolicy(s.changelog),
    aiTitles: s.aiTitles !== false,
  };
}

function readPolicy(saved: unknown): FeaturePolicy {
  const p = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
  const mode = FEATURE_MODES.includes(p.mode as FeatureMode) ? (p.mode as FeatureMode) : "default-on";
  const projects: Record<string, boolean> = {};
  if (p.projects && typeof p.projects === "object") {
    for (const [id, on] of Object.entries(p.projects)) if (typeof on === "boolean") projects[id] = on;
  }
  return { mode, projects };
}

/** Whether projects that haven't chosen (and new projects) have the feature. */
export function defaultOn(policy: FeaturePolicy): boolean {
  return policy.mode === "on" || policy.mode === "default-on";
}

/** Whether the organization set the feature for every project, so projects can't switch it. */
export function locked(policy: FeaturePolicy): boolean {
  return policy.mode === "on" || policy.mode === "off";
}

/** Whether the project has the feature. */
export function enabledFor(policy: FeaturePolicy, projectId: string): boolean {
  if (locked(policy)) return policy.mode === "on";
  return policy.projects[projectId] ?? defaultOn(policy);
}

/**
 * The policy with one project switched. A project switched back to the default is forgotten, so it follows the
 * default again if that changes. Refused while the organization has locked the feature.
 */
export function withProject(policy: FeaturePolicy, projectId: string, on: boolean): FeaturePolicy {
  if (locked(policy)) throw new Error("Your organization has set this for every project.");
  const projects = { ...policy.projects };
  if (on === defaultOn(policy)) delete projects[projectId];
  else projects[projectId] = on;
  return { ...policy, projects };
}

/** The settings were saved, but Azure DevOps didn't show or hide the hub to match. */
export class VisibilityNotSynced extends Error {}

/** One line for a feature's state in a project, for its settings page. */
export function describeAccess(policy: FeaturePolicy, projectId: string): string {
  if (policy.mode === "on") return "Your organization has turned this on for every project.";
  if (policy.mode === "off") return "Your organization has turned this off for every project.";
  const on = enabledFor(policy, projectId);
  const chosen = projectId in policy.projects;
  if (!chosen) return on ? "On, as for every project by default." : "Off, as for every project by default.";
  return on ? "On for this project. It's off by default." : "Off for this project. It's on by default.";
}
