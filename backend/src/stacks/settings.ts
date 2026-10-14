import { DEFAULT_TRUNK_PATTERNS } from "../../../src/stack/branches.js";
import { AdoError, type AdoClient } from "./ado.js";

/**
 * Where the extension stores per-project settings (extension/src/app/adoHost.ts, collection "project-settings").
 * The extension names itself in hook URLs and restack requests; EXTENSION_ID covers hooks subscribed before that.
 */
const DEFAULT_EXTENSION = process.env.EXTENSION_ID ?? "Cabochonio.review-deck";
const EXTENSION_ID = /^[A-Za-z0-9][\w-]*\.[A-Za-z0-9][\w-]*$/;

/** A publisher.extension id from a request, or undefined if absent or malformed. */
export function parseExtensionId(raw: unknown): string | undefined {
  return typeof raw === "string" && EXTENSION_ID.test(raw) ? raw : undefined;
}

const COLLECTION = "project-settings";

export interface StackSettings {
  autoRestack: boolean;
  trunkBranches: string[];
}

/** The project's stack settings, read fresh for every job; unreadable settings mean auto-restack is off. */
export async function stackSettings(ado: AdoClient, projectId: string, extensionId = DEFAULT_EXTENSION, log?: (message: string) => void): Promise<StackSettings> {
  const [publisher, extension] = extensionId.split(".");
  const url = `https://extmgmt.dev.azure.com/${ado.organization}/_apis/ExtensionManagement/InstalledExtensions/${publisher}/${extension}/Data/Scopes/Default/Current/Collections/${COLLECTION}/Documents/${encodeURIComponent(projectId)}`;
  try {
    const doc = await ado.request<{ autoRestack?: unknown; trunkBranches?: unknown }>("GET", url, { "api-version": "7.1-preview.1" });
    const trunks = Array.isArray(doc.trunkBranches) ? doc.trunkBranches.filter((t): t is string => typeof t === "string" && t.length > 0) : [];
    return { autoRestack: doc.autoRestack === true, trunkBranches: trunks.length ? trunks : DEFAULT_TRUNK_PATTERNS };
  } catch (e) {
    if (e instanceof AdoError && e.status === 404) {
      log?.(`no settings for project ${projectId} in extension ${extensionId} (does it match the installed extension?)`);
      return { autoRestack: false, trunkBranches: DEFAULT_TRUNK_PATTERNS };
    }
    if (e instanceof AdoError && (e.status === 401 || e.status === 403)) {
      throw new AdoError(e.status, `the restack identity can't read Review Deck's project settings (add it to the organization, or set ADO_PAT): ${e.message}`);
    }
    throw e;
  }
}
