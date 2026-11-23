import assert from "node:assert/strict";
import { test } from "node:test";
import type { Group, HunkInfo } from "../../core/types.js";
import { isLoose, MAX_FLOW_LINKS, readRelations, relationsOf } from "../relations.js";

/** A hunk with only what relationsOf reads. */
function hunk(id: string, defines: string[], references: string[], isTest = false): HunkInfo {
  return { hunk: { id }, defines: new Set(defines), references: new Set(references), isTest } as unknown as HunkInfo;
}
const concern = (id: string, hunkIds: string[]): Group => ({ id, kind: "semantic", hunkIds, title: id, rationale: "" });

test("Given a concern that uses a name another concern defines, then they are linked by that name", () => {
  const hunks = [hunk("a#0", ["TagFields", ".hide"], []), hunk("b#0", ["updateStyles"], ["TagFields", ".hide", "unrelated"])];
  const relations = relationsOf([concern("g1", ["a#0"]), concern("g2", ["b#0"])], new Map(hunks.map((h) => [h.hunk.id, h])));
  assert.deepEqual(relations.links, [{ from: "g1", to: "g2", kind: "uses", symbols: ["TagFields", ".hide"] }]);
});

test("Given a test that uses another concern's code, then the link is a test link, and code never uses a test", () => {
  const hunks = [hunk("src#0", ["parse"], ["helper"]), hunk("test#0", ["helper"], ["parse"], true)];
  const relations = relationsOf([concern("g1", ["src#0"]), concern("g2", ["test#0"])], new Map(hunks.map((h) => [h.hunk.id, h])));
  assert.deepEqual(relations.links, [{ from: "g1", to: "g2", kind: "tests", symbols: ["parse"] }]);
});

test("Given changes inside one concern that use each other, then they are its flow, not a link between concerns", () => {
  const hunks = [hunk("ids#0", ["createRequestId"], []), hunk("client#0", ["request"], ["createRequestId"]), hunk("errors#0", ["HttpError"], [])];
  const relations = relationsOf([concern("g1", ["ids#0", "client#0", "errors#0"])], new Map(hunks.map((h) => [h.hunk.id, h])));
  assert.deepEqual(relations.links, []);
  assert.deepEqual(relations.flows, { g1: [{ from: "ids#0", to: "client#0", kind: "uses", symbols: ["createRequestId"] }] });
});

test("Given misc and mechanical groups, then they are left out of the links", () => {
  const hunks = [hunk("a#0", ["x"], []), hunk("b#0", [], ["x"])];
  const groups: Group[] = [concern("g1", ["a#0"]), { id: "misc", kind: "misc", hunkIds: ["b#0"], title: "", rationale: "" }];
  assert.deepEqual(relationsOf(groups, new Map(hunks.map((h) => [h.hunk.id, h]))).links, []);
});

test("Given a concern with too many internal links to draw, then it has no flow", () => {
  const ids = Array.from({ length: MAX_FLOW_LINKS + 2 }, (_, i) => `f#${i}`);
  const hunks = [hunk("def#0", ["shared"], []), ...ids.map((id) => hunk(id, [], ["shared"]))];
  const relations = relationsOf([concern("g1", ["def#0", ...ids])], new Map(hunks.map((h) => [h.hunk.id, h])));
  assert.equal(relations.flows.g1, undefined);
});

test("Given saved relations, then links to unknown groups or hunks and malformed ones are dropped", () => {
  const raw = {
    links: [{ from: "g1", to: "g2", kind: "uses", symbols: ["a"] }, { from: "g1", to: "gone", kind: "uses", symbols: [] }, { from: "g1", to: "g2", kind: "calls", symbols: [] }],
    flows: { g1: [{ from: "a#0", to: "b#0", kind: "tests", symbols: ["x"] }, { from: "a#0", to: "zzz#9", kind: "uses", symbols: [] }], gone: [] },
  };
  assert.deepEqual(readRelations(raw, new Set(["g1", "g2"]), new Set(["a#0", "b#0"])), {
    links: [{ from: "g1", to: "g2", kind: "uses", symbols: ["a"] }],
    flows: { g1: [{ from: "a#0", to: "b#0", kind: "tests", symbols: ["x"] }] },
  });
  assert.equal(readRelations({ links: "no" }, new Set(), new Set()), null);
  assert.equal(readRelations(undefined, new Set(), new Set()), null);
});

test("Given a link that rests only on member names, then it is loose", () => {
  assert.equal(isLoose({ from: "g1", to: "g2", kind: "uses", symbols: [".hide", ".tags"] }), true);
  assert.equal(isLoose({ from: "g1", to: "g2", kind: "uses", symbols: ["TagFields", ".hide"] }), false);
});

test("Given a concern of fewer than three changes, then it has no flow", () => {
  const hunks = [hunk("a#0", ["x"], []), hunk("b#0", [], ["x"])];
  assert.deepEqual(relationsOf([concern("g1", ["a#0", "b#0"])], new Map(hunks.map((h) => [h.hunk.id, h]))).flows, {});
});

test("Given linked and unlinked concerns, then the map draws the linked ones, merges both directions, and puts the rest apart", async () => {
  const { layoutRelations, startOf } = await import("../diagram.js");
  const items = ["g1", "g2", "g3", "g4"].map((id) => ({ id, title: `Concern ${id}`, subtitle: "2 changes" }));
  const map = layoutRelations(
    items,
    [
      { from: "g1", to: "g2", kind: "uses", symbols: ["TagFields"] },
      { from: "g2", to: "g1", kind: "tests", symbols: ["AdoTagStore"] },
      { from: "g2", to: "g3", kind: "uses", symbols: [".hide"] },
    ],
    { width: 700, height: 300 },
  );
  assert.ok(map);
  assert.deepEqual(map.nodes.map((n) => n.id).sort(), ["g1", "g2"]);
  // g2 to g3 rests on a member name only: not drawn, so g3 is apart with g4.
  assert.deepEqual(map.apart.map((n) => n.id), ["g3", "g4"]);
  assert.deepEqual(map.edges.map((e) => [e.from, e.to, e.both, e.tests, e.symbols]), [["g1", "g2", true, false, ["TagFields", "AdoTagStore"]]]);
  assert.equal(startOf(map), null);
  for (const n of [...map.nodes, ...map.apart]) assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.width <= map.width && n.y + n.height <= map.height, n.id);
});

test("Given a chain of uses, then reading starts at the one change everything else builds on", async () => {
  const { layoutRelations, startOf } = await import("../diagram.js");
  const items = ["a", "b", "c"].map((id) => ({ id, title: id, subtitle: null }));
  // d also uses nothing, but only c depends on it; a leads to b and c.
  const map = layoutRelations(
    [...items, { id: "d", title: "d", subtitle: null }],
    [{ from: "a", to: "b", kind: "uses", symbols: ["x"] }, { from: "b", to: "c", kind: "uses", symbols: ["y"] }, { from: "d", to: "c", kind: "uses", symbols: ["z"] }],
    { width: 700, height: 300 },
  );
  assert.equal(startOf(map!), "a");
});

/** A hunk in `path`, inside `symbol`, with only what concernFlow reads. */
function inFile(id: string, path: string, symbol: string | null): HunkInfo {
  return { hunk: { id, index: Number(id.split("#")[1]) }, file: { path }, symbol, defines: new Set(), references: new Set(), isTest: false } as unknown as HunkInfo;
}

test("Given many changes inside one function of one file, then the concern's flow shows them as one box with their count", async () => {
  const { concernFlow } = await import("../flow.js");
  const ids = ["src/cleanup.ts#0", "src/cleanup.ts#1", "src/cleanup.ts#2", "src/layer.ts#0", "src/env.ts#0"];
  const hunks = new Map([
    ...ids.slice(0, 3).map((id) => [id, inFile(id, "src/cleanup.ts", "make")] as const),
    ["src/layer.ts#0", inFile("src/layer.ts#0", "src/layer.ts", "StorageLayer")],
    ["src/env.ts#0", inFile("src/env.ts#0", "src/env.ts", "make")],
  ]);
  const links = [
    ...ids.slice(0, 3).map((from) => ({ from, to: "src/layer.ts#0", kind: "uses" as const, symbols: ["make"] })),
    { from: "src/cleanup.ts#0", to: "src/cleanup.ts#2", kind: "uses" as const, symbols: ["reason"] },
    { from: "src/env.ts#0", to: "src/layer.ts#0", kind: "uses" as const, symbols: ["make"] },
  ];
  const flow = concernFlow(concern("g1", ids), { links: [], flows: { g1: links } }, hunks);
  // Two `make`s in two files: the file goes in the title. The link inside the first box is left out.
  assert.deepEqual(flow.boxes.map((b) => [b.title, b.subtitle, b.hunkIds.length]).sort(), [
    ["StorageLayer", "layer.ts", 1],
    ["make · cleanup.ts", "3 changes", 3],
    ["make · env.ts", null, 1],
  ]);
  assert.equal(flow.links.length, 2);
  assert.equal(flow.tooMany, false);
  assert.equal(flow.unlinked, 0);
});

test("Given more boxes than a map can show, then the flow says so instead of drawing them", async () => {
  const { concernFlow, MAX_FLOW_BOXES } = await import("../flow.js");
  const ids = Array.from({ length: MAX_FLOW_BOXES + 1 }, (_, i) => `src/f${i}.ts#0`);
  const hunks = new Map([["src/def.ts#0", inFile("src/def.ts#0", "src/def.ts", "def")], ...ids.map((id, i) => [id, inFile(id, `src/f${i}.ts`, `user${i}`)] as const)]);
  const links = ids.map((to) => ({ from: "src/def.ts#0", to, kind: "uses" as const, symbols: ["def"] }));
  const flow = concernFlow(concern("g1", ["src/def.ts#0", ...ids]), { links: [], flows: { g1: links } }, hunks);
  assert.equal(flow.tooMany, true);
});
