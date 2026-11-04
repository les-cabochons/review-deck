import type { BlobLoad } from "./blobs";
import type { FileChange } from "./model";

/** The two reads behind the Files tab, bound to a pull request (adoSource.ts binds them to the REST client). */
export interface FileReadsSource {
  /** Changes between update `compareTo` (0 = the PR's base) and update `iteration`. */
  changes(iteration: number, compareTo: number): Promise<FileChange[]>;
  /** The text of these blobs (data/blobs.ts); `signal` stops what hasn't been read yet. */
  blobs(objectIds: string[], signal: AbortSignal): Promise<BlobLoad>;
}

/** A read under way, or done and waiting for the build; handed to the next caller asking for the same thing. */
interface Shared<T> {
  promise: Promise<T>;
  /** Stops what's left of the read once the build holding it is cancelled. */
  controller: AbortController;
}

/**
 * The Files tab's reads (the update's changes, then both sides of every changed file), shared between the prefetch
 * a link straight to a PR starts (`prime`, from adoSource.ts as soon as the PR's updates are in) and the build
 * (review/engine.ts buildReview, once React has mounted the page): whichever asks first starts the read, and the
 * other takes it over instead of reading again. The prefetch's reads stay until the build takes them; a build's own
 * read is forgotten once it settles. A read that failed is forgotten too, so the next ask tries again, and a build
 * cancelled while holding a read stops what's left of it, as nobody else will take it.
 */
export class FileReads {
  private readonly changes = new Map<string, Shared<FileChange[]>>();
  private readonly blobs = new Map<string, Shared<BlobLoad>>();

  constructor(private readonly source: FileReadsSource) {}

  /** Starts the reads for update `iteration` against the PR's base, for the build that will ask for them. A failure is left for it to report. */
  prime(iteration: number): void {
    this.share(this.changes, changesKey(iteration, 0), () => this.source.changes(iteration, 0), true)
      .then((changes) => {
        const ids = blobIds(changes);
        return this.share(this.blobs, blobsKey(ids), (signal) => this.source.blobs(ids, signal), true);
      })
      .catch(() => {});
  }

  getChanges(iteration: number, compareTo: number): Promise<FileChange[]> {
    return this.share(this.changes, changesKey(iteration, compareTo), () => this.source.changes(iteration, compareTo), false);
  }

  async getBlobs(objectIds: string[], signal?: AbortSignal): Promise<BlobLoad> {
    // A build cancelled between its two reads: nothing to start, and a prefetched read stays for the next build.
    signal?.throwIfAborted();
    return this.share(this.blobs, blobsKey(objectIds), (s) => this.source.blobs(objectIds, s), false, signal);
  }

  /**
   * The read shared under `key`, taken (the next caller reads again), or else a new one, shared with the next
   * caller: until taken if `keep` (the prefetch's), until it settles otherwise (a build's). A build's `signal`
   * stops the read it holds when the build is cancelled.
   */
  private share<T>(shared: Map<string, Shared<T>>, key: string, read: (signal: AbortSignal) => Promise<T>, keep: boolean, signal?: AbortSignal): Promise<T> {
    let entry = shared.get(key);
    if (entry) shared.delete(key);
    else {
      const controller = new AbortController();
      const started: Shared<T> = { promise: read(controller.signal), controller };
      entry = started;
      shared.set(key, started);
      const forget = () => void (shared.get(key) === started && shared.delete(key));
      started.promise.then(keep ? undefined : forget, forget);
    }
    if (signal) {
      const held = entry;
      // Nobody else will take it once the build that holds it is cancelled: it leaves the shared reads and stops.
      signal.addEventListener(
        "abort",
        () => {
          if (shared.get(key) === held) shared.delete(key);
          held.controller.abort();
        },
        { once: true },
      );
    }
    return entry.promise;
  }
}

/** Both sides of every changed file, as the build reads them (review/engine.ts). */
export function blobIds(changes: FileChange[]): string[] {
  return changes.flatMap((c) => [c.oldObjectId, c.newObjectId]).filter((id): id is string => !!id);
}

const changesKey = (iteration: number, compareTo: number) => `${iteration}:${compareTo}`;

/** The same blobs in any order are the same read. */
const blobsKey = (objectIds: string[]) => [...new Set(objectIds)].sort().join(" ");
