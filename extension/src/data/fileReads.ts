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
  /** Started by the prefetch and not taken yet, so no build holds it. */
  primed: boolean;
}

/**
 * The Files tab's reads (the update's changes, then both sides of every changed file), shared between the prefetch
 * a link straight to a PR starts (`prime`, from adoSource.ts as soon as the PR's updates are in) and the build
 * (review/engine.ts buildReview, once React has mounted the page). The prefetch's reads stay until the build takes
 * them over instead of reading again. The build's own reads are forgotten once they settle, and the prefetch starts
 * nothing the build has asked for already: opened from a kept copy, the build is ahead of the prefetch, and its reads
 * may be done by the time the PR's updates land. A read that failed is forgotten too, so the next ask tries again.
 * A build cancelled while holding a read stops what's left of it, as nobody else will take it; cancelled between
 * its two reads, it stops the blobs read primed for it too.
 */
export class FileReads {
  private readonly changes = new Map<string, Shared<FileChange[]>>();
  private readonly blobs = new Map<string, Shared<BlobLoad>>();
  /** What a build has asked for so far: it holds the read or has it, so the prefetch adds nothing to it. */
  private readonly asked = new Set<string>();

  constructor(private readonly source: FileReadsSource) {}

  /** Starts the reads for update `iteration` against the PR's base, for the build that will ask for them. A failure is left for it to report. */
  prime(iteration: number): void {
    const key = changesKey(iteration, 0);
    if (this.asked.has(key)) return;
    this.share(this.changes, key, () => this.source.changes(iteration, 0), true)
      .then((changes) => {
        const ids = blobIds(changes);
        const blobs = blobsKey(ids);
        if (this.asked.has(blobs)) return;
        return this.share(this.blobs, blobs, (signal) => this.source.blobs(ids, signal), true);
      })
      .catch(() => {});
  }

  getChanges(iteration: number, compareTo: number): Promise<FileChange[]> {
    const key = changesKey(iteration, compareTo);
    this.asked.add(key);
    return this.share(this.changes, key, () => this.source.changes(iteration, compareTo), false);
  }

  async getBlobs(objectIds: string[], signal?: AbortSignal): Promise<BlobLoad> {
    const key = blobsKey(objectIds);
    this.asked.add(key);
    if (signal?.aborted) {
      // A build cancelled between its two reads (the page left while the changes were on their way) starts nothing,
      // and the blobs read primed for it stops, as nobody else will take it. A read another build started stays.
      const primed = this.blobs.get(key);
      if (primed?.primed) stop(this.blobs, key, primed);
      throw signal.reason;
    }
    return this.share(this.blobs, key, (s) => this.source.blobs(objectIds, s), false, signal);
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
      const started: Shared<T> = { promise: read(controller.signal), controller, primed: keep };
      entry = started;
      shared.set(key, started);
      const forget = () => void (shared.get(key) === started && shared.delete(key));
      started.promise.then(keep ? undefined : forget, forget);
    }
    if (signal) {
      const held = entry;
      signal.addEventListener("abort", () => stop(shared, key, held), { once: true });
    }
    return entry.promise;
  }
}

/** `entry` leaves the shared reads and stops: the build it was for is cancelled, and nobody else will take it. */
function stop<T>(shared: Map<string, Shared<T>>, key: string, entry: Shared<T>): void {
  if (shared.get(key) === entry) shared.delete(key);
  entry.controller.abort();
}

/** Both sides of every changed file, as the build reads them (review/engine.ts). */
export function blobIds(changes: FileChange[]): string[] {
  return changes.flatMap((c) => [c.oldObjectId, c.newObjectId]).filter((id): id is string => !!id);
}

const changesKey = (iteration: number, compareTo: number) => `${iteration}:${compareTo}`;

/** The same blobs in any order are the same read. */
const blobsKey = (objectIds: string[]) => [...new Set(objectIds)].sort().join(" ");
