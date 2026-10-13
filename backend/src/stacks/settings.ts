import { DEFAULT_TRUNK_PATTERNS } from "../../../src/stack/branches.js";
import { AdoError, type AdoClient } from "./ado.js";

/** Where the extension stores per-project settings (extension/src/app/adoHost.ts, collection "project-settings"). */
const EXTENSION = process.env.EXTENSION_ID ?? "Cabochonio.semantic-pr-review";
const COLLECTION = "project-settings";

export interface StackSettings {
  autoRestack: boolean;
  trunkBranches: string[];
}

/** The project's stack settings, read fresh for every job; unreadable settings mean auto-restack is off. */
export async function stackSettings(ado: AdoClient, projectId: string): Promise<StackSettings> {
  const [publisher, extension] = EXTENSION.split(".");
  const url = `https://extmgmt.dev.azure.com/${ado.organization}/_apis/ExtensionManagement/InstalledExtensions/${publisher}/${extension}/Data/Scopes/Default/Current/Collections/${COLLECTION}/Documents/${encodeURIComponent(projectId)}`;
  try {
    const doc = await ado.request<{ autoRestack?: unknown; trunkBranches?: unknown }>("GET", url, { "api-version": "7.1-preview.1" });
    const trunks = Array.isArray(doc.trunkBranches) ? doc.trunkBranches.filter((t): t is string => typeof t === "string" && t.length > 0) : [];
    return { autoRestack: doc.autoRestack === true, trunkBranches: trunks.length ? trunks : DEFAULT_TRUNK_PATTERNS };
  } catch (e) {
    if (e instanceof AdoError && e.status === 404) return { autoRestack: false, trunkBranches: DEFAULT_TRUNK_PATTERNS };
    throw e;
  }
}
