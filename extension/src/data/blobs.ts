/**
 * Loads the text of many blobs at once. Azure DevOps answers each REST call in 250 to 500 ms, so two calls per
 * changed file, sixteen at a time, made a 40-file PR's diff wait about two seconds. Here the blobs come from
 * this browser's cache first (blobs are content-addressed, so a kept one is never stale), then from one zip call
 * per batch, and one call per blob only for what the zip didn't carry.
 */

/** Reads from a repository (adoSource.ts binds them to the REST client). */
export interface BlobReads {
  /** Many blobs as one zip (POST .../blobs), each entry named by its blob id. */
  zip(objectIds: string[]): Promise<ArrayBuffer>;
  /** One blob's bytes. */
  one(objectId: string): Promise<ArrayBuffer>;
}

/** Blobs kept in this browser, by id (blobCache.ts). Both may reject; the loader then goes without. */
export interface BlobCache {
  get(objectIds: string[]): Promise<Map<string, string>>;
  put(blobs: Map<string, string>): Promise<void>;
}

/** Where a load's blobs came from, for the build's log line. */
export interface BlobLoadStats {
  cached: number;
  zipped: number;
  single: number;
  /** REST calls made. */
  calls: number;
}

/** Blob ids per zip call. A batch of source files stays a few MB, and a huge PR makes several calls at once. */
const ZIP_BATCH = 200;
const ZIP_CONCURRENCY = 4;
/** Single reads in flight at once; Azure DevOps throttles bursts. */
const SINGLE_CONCURRENCY = 16;

/**
 * Whether the zip's entries could be matched to blob ids. If a zip ever comes back with entries named some other
 * way, zipping stops for the rest of the page. Every blob would fall back to its own call, and the zip call would
 * only add to the wait.
 */
let zipUsable = true;

export class BlobLoader {
  constructor(
    private readonly reads: BlobReads,
    private readonly cache: BlobCache | null,
  ) {}

  /** The text of every blob, by id. Rejects if a blob can't be read at all, as one missing side fails the diff. */
  async load(objectIds: string[], signal?: AbortSignal): Promise<{ blobs: Map<string, string>; stats: BlobLoadStats }> {
    const ids = [...new Set(objectIds)];
    const stats: BlobLoadStats = { cached: 0, zipped: 0, single: 0, calls: 0 };
    const blobs = await this.fromCache(ids);
    stats.cached = blobs.size;
    const missing = ids.filter((id) => !blobs.has(id));
    const fetched = new Map<string, string>();
    if (zipUsable && missing.length > 1) {
      const batches: string[][] = [];
      for (let i = 0; i < missing.length; i += ZIP_BATCH) batches.push(missing.slice(i, i + ZIP_BATCH));
      await forEachLimited(
        batches,
        ZIP_CONCURRENCY,
        async (batch) => {
          stats.calls++;
          let entries: Map<string, Uint8Array>;
          try {
            entries = await unzip(await this.reads.zip(batch));
          } catch (e) {
            // Read one by one below; a zip that fails once may be a passing error.
            console.warn("[review-deck] could not read blobs as a zip:", e);
            return;
          }
          let matched = 0;
          for (const id of batch) {
            const bytes = entries.get(entryKey(id));
            if (!bytes) continue;
            fetched.set(id, decode(bytes));
            matched++;
          }
          if (matched === 0 && entries.size > 0) {
            zipUsable = false;
            console.warn("[review-deck] blob zip entries aren't named by blob id; reading blobs one by one from now on:", [...entries.keys()].slice(0, 3));
          }
        },
        signal,
      );
    }
    stats.zipped = fetched.size;
    await forEachLimited(
      missing.filter((id) => !fetched.has(id)),
      SINGLE_CONCURRENCY,
      async (id) => {
        stats.calls++;
        fetched.set(id, decode(new Uint8Array(await this.reads.one(id))));
        stats.single++;
      },
      signal,
    );
    if (fetched.size > 0 && this.cache) {
      // Kept for next time; the diff doesn't wait for it.
      this.cache.put(fetched).catch((e: unknown) => console.warn("[review-deck] could not keep blobs:", e));
    }
    for (const [id, text] of fetched) blobs.set(id, text);
    return { blobs, stats };
  }

  private async fromCache(ids: string[]): Promise<Map<string, string>> {
    if (!this.cache) return new Map();
    try {
      return await this.cache.get(ids);
    } catch (e) {
      console.warn("[review-deck] could not read kept blobs:", e);
      return new Map();
    }
  }
}

/** Tests only. */
export function resetZipUsable(): void {
  zipUsable = true;
}

/** A zip entry's name as a blob id, without folders or an extension and in lower case, as ids are. */
function entryKey(name: string): string {
  return name.split("/").pop()!.replace(/\.[^.]*$/, "").toLowerCase();
}

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

export async function forEachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>, signal?: AbortSignal): Promise<void> {
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      signal?.throwIfAborted();
      await fn(items[next++]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

// A zip's central directory, at its end, lists every entry with its sizes and where its local header starts.
const CENTRAL_DIRECTORY_END = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

/**
 * The entries of a zip, keyed as `entryKey` names them. Stored and deflated entries only, as Azure DevOps writes;
 * anything else is left out, and the loader reads those blobs one by one.
 */
export async function unzip(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  // The end record is the last 22 bytes, plus a comment of up to 64K.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === CENTRAL_DIRECTORY_END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("Not a zip file");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries = new Map<string, Uint8Array>();
  const names = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_ENTRY) throw new Error("Malformed zip directory");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = names.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (view.getUint32(local, true) !== LOCAL_HEADER) throw new Error("Malformed zip entry");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + compressedSize);
    if (method === STORED) entries.set(entryKey(name), data);
    else if (method === DEFLATED) entries.set(entryKey(name), await inflate(data));
  }
  return entries;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
