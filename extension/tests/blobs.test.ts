import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { type BlobCache, BlobLoader, type BlobReads, resetZipUsable, unzip } from "../src/data/blobs";

/** A zip as Azure DevOps' blobs endpoint writes one, each entry named by its blob id, stored or deflated. */
function zip(entries: { name: string; text: string; stored?: boolean }[]): ArrayBuffer {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const raw = Buffer.from(e.text);
    const data = e.stored ? raw : deflateRawSync(raw);
    const method = e.stored ? 0 : 8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(Buffer.concat([central, name]));
    parts.push(local, name, data);
    offset += local.length + name.length + data.length;
  }
  const dir = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  const all = Buffer.concat([...parts, dir, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);
}

const text = (bytes: Uint8Array | undefined) => bytes && new TextDecoder().decode(bytes);

test("Given a zip with stored and deflated entries, then each comes back by its name, without folder or extension", async () => {
  const entries = await unzip(zip([{ name: "AAA111", text: "stored text", stored: true }, { name: "blobs/bbb222.txt", text: "x".repeat(5000) }]));
  assert.equal(text(entries.get("aaa111")), "stored text");
  assert.equal(text(entries.get("bbb222")), "x".repeat(5000));
  assert.equal(entries.size, 2);
  await assert.rejects(unzip(new TextEncoder().encode("not a zip at all, but long enough").buffer), /Not a zip/);
});

/** Reads that answer from `blobs`, counting calls; the zip leaves out `skip`. */
function reads(blobs: Record<string, string>, options: { skip?: string[]; names?: (id: string) => string; failZip?: boolean } = {}) {
  const calls = { zip: [] as string[][], one: [] as string[] };
  const r: BlobReads = {
    zip: async (ids) => {
      calls.zip.push(ids);
      if (options.failZip) throw new Error("zip unavailable");
      return zip(ids.filter((id) => !options.skip?.includes(id)).map((id) => ({ name: options.names?.(id) ?? id, text: blobs[id] })));
    },
    one: async (id) => {
      calls.one.push(id);
      if (!(id in blobs)) throw new Error(`no blob ${id}`);
      return new TextEncoder().encode(blobs[id]).buffer as ArrayBuffer;
    },
  };
  return { reads: r, calls };
}

function memoryCache(initial: Record<string, string> = {}) {
  const kept = new Map(Object.entries(initial));
  const cache: BlobCache = {
    get: async (ids) => new Map(ids.filter((id) => kept.has(id)).map((id) => [id, kept.get(id)!])),
    put: async (blobs) => void blobs.forEach((t, id) => kept.set(id, t)),
  };
  return { cache, kept };
}

const BLOBS = { a1: "old a", a2: "new a", b1: "old b", b2: "new b" };

test("Given blobs not kept yet, then one zip call reads them all, and they're kept for next time", async () => {
  resetZipUsable();
  const { reads: r, calls } = reads(BLOBS);
  const { cache, kept } = memoryCache();
  const { blobs, stats } = await new BlobLoader(r, cache).load(["a1", "a2", "b1", "b2", "a1"]);
  assert.deepEqual([...blobs], Object.entries(BLOBS));
  assert.deepEqual(calls, { zip: [["a1", "a2", "b1", "b2"]], one: [] });
  assert.deepEqual(stats, { cached: 0, zipped: 4, single: 0, calls: 1 });
  await new Promise((ok) => setTimeout(ok, 0));
  assert.equal(kept.size, 4);
});

test("Given blobs kept from before, then only the rest are read, and a single missing one alone isn't zipped", async () => {
  resetZipUsable();
  const { reads: r, calls } = reads(BLOBS);
  const { cache } = memoryCache({ a1: "old a", a2: "new a", b1: "old b" });
  const { blobs, stats } = await new BlobLoader(r, cache).load(["a1", "a2", "b1", "b2"]);
  assert.equal(blobs.get("b2"), "new b");
  assert.deepEqual(calls, { zip: [], one: ["b2"] });
  assert.deepEqual(stats, { cached: 3, zipped: 0, single: 1, calls: 1 });
});

test("Given a zip that leaves a blob out, or entries with folders and extensions, then the rest are read one by one", async () => {
  resetZipUsable();
  const { reads: r, calls } = reads(BLOBS, { skip: ["b2"], names: (id) => `blobs/${id.toUpperCase()}.bin` });
  const { blobs, stats } = await new BlobLoader(r, null).load(["a1", "a2", "b1", "b2"]);
  assert.deepEqual([...blobs], Object.entries(BLOBS));
  assert.deepEqual(calls.one, ["b2"]);
  assert.deepEqual(stats, { cached: 0, zipped: 3, single: 1, calls: 2 });
});

test("Given a zip call that fails, then every blob is read one by one, and a blob that can't be read fails the load", async () => {
  resetZipUsable();
  const { reads: r, calls } = reads(BLOBS, { failZip: true });
  const { blobs } = await new BlobLoader(r, null).load(["a1", "b2"]);
  assert.deepEqual([...blobs], [["a1", "old a"], ["b2", "new b"]]);
  assert.deepEqual(calls.one, ["a1", "b2"]);
  await assert.rejects(new BlobLoader(r, null).load(["a1", "zz"]), /no blob zz/);
});

test("Given zip entries not named by blob id, then zipping stops for the rest of the page", async () => {
  resetZipUsable();
  const { reads: r, calls } = reads(BLOBS, { names: (id) => `file-${Object.keys(BLOBS).indexOf(id)}` });
  const loader = new BlobLoader(r, null);
  await loader.load(["a1", "a2"]);
  await loader.load(["b1", "b2"]);
  assert.deepEqual(calls, { zip: [["a1", "a2"]], one: ["a1", "a2", "b1", "b2"] });
  resetZipUsable();
});

test("Given a cache that fails, then the blobs still load", async () => {
  resetZipUsable();
  const { reads: r } = reads(BLOBS);
  const broken: BlobCache = { get: async () => { throw new Error("quota"); }, put: async () => { throw new Error("quota"); } };
  const { blobs, stats } = await new BlobLoader(r, broken).load(["a1", "a2"]);
  assert.equal(blobs.size, 2);
  assert.equal(stats.cached, 0);
});
