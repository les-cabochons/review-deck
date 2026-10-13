import type { IExtensionDataManager } from "azure-devops-extension-api/Common";
import { mergeTags, type TagDef, type TagStore, type TagStyles, withoutTag, withTag } from "../data/tags";

/** Extension data collection holding one tag-styles document per project, keyed by project ID. */
const TAGS_COLLECTION = "tag-styles";
const API = "api-version=7.1-preview.1";

interface Env {
  /** https://dev.azure.com/org/ */
  hostUrl: string;
  projectId: string;
  token: () => Promise<string>;
  data: () => Promise<IExtensionDataManager>;
}

/**
 * Tags are the project's tag definitions (shared by pull requests and work items, `_apis/wit/tags`);
 * colors and descriptions are extension data. Renaming or deleting changes the Azure DevOps tag, so
 * it applies to every pull request and work item that has it.
 */
export class AdoTagStore implements TagStore {
  constructor(private readonly env: Env) {}

  async list(): Promise<TagDef[]> {
    const [names, styles] = await Promise.all([
      this.definitions().then(
        (d) => d.map((t) => t.name),
        (e) => {
          console.warn("[semantic-pr] could not list project tags:", e);
          return [];
        },
      ),
      this.styles(),
    ]);
    return mergeTags(names, styles);
  }

  async save(previous: string | null, tag: TagDef): Promise<void> {
    if (previous && previous !== tag.name) {
      const existing = (await this.definitions()).find((t) => t.name.toLowerCase() === previous.toLowerCase());
      // A tag created here but never applied has no Azure DevOps definition yet: only its style moves.
      if (existing) await this.call("PATCH", existing.id, { name: tag.name.trim() });
    }
    await this.writeStyles(withTag(await this.styles(true), previous, tag));
  }

  async remove(name: string): Promise<void> {
    const existing = (await this.definitions()).find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) await this.call("DELETE", existing.id);
    await this.writeStyles(withoutTag(await this.styles(true), name));
  }

  private async definitions(): Promise<{ id: string; name: string }[]> {
    const body = (await this.call("GET")) as { value?: { id: string; name: string; active?: boolean }[] };
    return (body.value ?? []).filter((t) => t.active !== false);
  }

  private async call(method: "GET" | "PATCH" | "DELETE", id?: string, body?: unknown): Promise<unknown> {
    const url = `${this.env.hostUrl}${this.env.projectId}/_apis/wit/tags${id ? `/${encodeURIComponent(id)}` : ""}?${API}`;
    const response = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${await this.env.token()}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.json().then((j: { message?: string }) => j.message, () => undefined);
      throw new Error(detail ?? `Azure DevOps answered HTTP ${response.status}.`);
    }
    return response.status === 204 ? null : response.json().catch(() => null);
  }

  /** `forWrite`: rethrow read failures rather than save over styles we couldn't read. */
  private async styles(forWrite = false): Promise<TagStyles> {
    try {
      const doc = (await (await this.env.data()).getDocument(TAGS_COLLECTION, this.env.projectId)) as { tags?: TagStyles };
      return doc.tags ?? {};
    } catch (e) {
      // A project that never styled a tag has no document (404).
      if ((e as { status?: number }).status === 404) return {};
      if (forWrite) throw e;
      console.warn("[semantic-pr] tag colors unavailable:", e);
      return {};
    }
  }

  private async writeStyles(tags: TagStyles): Promise<void> {
    // __etag -1: last write wins.
    await (await this.env.data()).setDocument(TAGS_COLLECTION, { id: this.env.projectId, __etag: -1, tags });
  }
}
