import type { BlobCache } from "./blobs";

/**
 * Blobs this browser read before, in IndexedDB, so a PR opened again, its next update (most files unchanged) or
 * another PR on the same base draws its diff without reading them again. A blob's id is its content's hash, so
 * a kept blob is never stale; entries only age out. Keyed per organization and user, like the other caches, so
 * people sharing a browser profile don't see each other's files.
 */
const DB_NAME = "review-deck-blobs";
const STORE = "blobs";
const VERSION = 1;
/**
 * Kept this long after it was saved. Finding a blob here doesn't renew it, so a blob read every day is read again
 * once a month.
 */
const MAX_AGE_MS = 30 * 86_400_000;
/** A blob longer than this (a bundle, a lockfile) isn't kept. One would take the room of hundreds of sources. */
const MAX_CHARS = 1_000_000;

interface Record {
  key: string;
  text: string;
  at: number;
}

const caches = new Map<string, BlobCache>();

/** The cache for `scope` (organization and user), or null where the browser has no IndexedDB. */
export function openBlobCache(scope: string): BlobCache | null {
  if (typeof indexedDB === "undefined") return null;
  let cache = caches.get(scope);
  if (!cache) caches.set(scope, (cache = new IndexedDbBlobCache(scope)));
  return cache;
}

class IndexedDbBlobCache implements BlobCache {
  private db: Promise<IDBDatabase> | null = null;
  private pruned = false;

  constructor(private readonly scope: string) {}

  async get(objectIds: string[]): Promise<Map<string, string>> {
    const db = await this.open();
    const store = db.transaction(STORE, "readonly").objectStore(STORE);
    const now = Date.now();
    const found = await Promise.all(objectIds.map((id) => request<Record | undefined>(store.get(this.key(id)))));
    const blobs = new Map<string, string>();
    found.forEach((record, i) => {
      if (record && now - record.at < MAX_AGE_MS) blobs.set(objectIds[i], record.text);
    });
    return blobs;
  }

  async put(blobs: Map<string, string>): Promise<void> {
    const db = await this.open();
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const at = Date.now();
    for (const [id, text] of blobs) if (text.length <= MAX_CHARS) store.put({ key: this.key(id), text, at } satisfies Record);
    // Once per page, drop what aged out, whoever kept it.
    if (!this.pruned) {
      this.pruned = true;
      const old = store.index("at").openCursor(IDBKeyRange.upperBound(at - MAX_AGE_MS));
      old.onsuccess = () => {
        const cursor = old.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
    }
    await done(transaction);
  }

  private key(id: string): string {
    return `${this.scope}:${id}`;
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const opening = indexedDB.open(DB_NAME, VERSION);
      opening.onupgradeneeded = () => {
        const store = opening.result.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("at", "at");
      };
      opening.onsuccess = () => {
        const db = opening.result;
        // Another tab upgrading, or the browser clearing storage. The next use opens again.
        db.onversionchange = () => {
          db.close();
          this.db = null;
        };
        resolve(db);
      };
      opening.onerror = () => reject(opening.error ?? new Error("Could not open the blob cache"));
      opening.onblocked = () => reject(new Error("The blob cache is open in another tab"));
    });
    this.db.catch(() => (this.db = null));
    return this.db;
  }
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("Blob cache request failed"));
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Blob cache write failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Blob cache write aborted"));
  });
}
