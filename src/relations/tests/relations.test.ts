import assert from "node:assert/strict";
import { test } from "node:test";
import type { Group, HunkInfo } from "../../core/types.js";
import { isLoose, MAX_FLOW_LINKS, readRelations, relationsOf } from "../relations.js";

/** A hunk with only what relationsOf reads. */
function hunk(id: string, defines: string[], references: string[], isTest = false): HunkInfo {
  return { hunk: { id }, file: { path: id.split("#")[0] }, defines: new Set(defines), references: new Set(references), isTest } as unknown as HunkInfo;
}
const concern = (id: string, hunkIds: string[]): Group => ({ id, kind: "semantic", hunkIds, title: id, rationale: "" });

test("Given a concern that uses a name another concern defines, then they are linked by that name", () => {
  const hunks = [hunk("a#0", ["TagFields", ".hide"], []), hunk("b#0", ["updateStyles"], ["TagFields", ".hide", "unrelated"])];
  const relations = relationsOf([concern("g1", ["a#0"]), concern("g2", ["b#0"])], new Map(hunks.map((h) => [h.hunk.id, h])));
  assert.deepEqual(relations.links, [{ from: "g1", to: "g2", symbols: ["TagFields", ".hide"] }]);
});

test("Given test files, then they are left out: a test calling the code it tests links nothing", () => {
  const hunks = [hunk("src#0", ["parse"], []), hunk("other#0", [], ["parse"]), hunk("test#0", ["helper"], ["parse"], true)];
  const relations = relationsOf([concern("g1", ["src#0"]), concern("g2", ["other#0"]), concern("g3", ["test#0"])], new Map(hunks.map((h) => [h.hunk.id, h])));
  assert.deepEqual(relations.links, [{ from: "g1", to: "g2", symbols: ["parse"] }]);
});

test("Given changes inside one concern that use each other, then they are its flow, not a link between concerns", () => {
  const hunks = [hunk("ids#0", ["createRequestId"], []), hunk("client#0", ["request"], ["createRequestId"]), hunk("errors#0", ["HttpError"], [])];
  const relations = relationsOf([concern("g1", ["ids#0", "client#0", "errors#0"])], new Map(hunks.map((h) => [h.hunk.id, h])));
  assert.deepEqual(relations.links, []);
  assert.deepEqual(relations.flows, { g1: [{ from: "ids#0", to: "client#0", symbols: ["createRequestId"] }] });
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

test("Given saved relations, then links to unknown groups or hunks, test links saved before tests were left out, and malformed ones are dropped", () => {
  const raw = {
    links: [{ from: "g1", to: "g2", symbols: ["a"] }, { from: "g1", to: "gone", symbols: [] }, { from: "g2", to: "g1", kind: "tests", symbols: ["t"] }, { from: "g1", to: "g2", symbols: "no" }],
    flows: { g1: [{ from: "a#0", to: "b#0", symbols: ["x"] }, { from: "a#0", to: "zzz#9", symbols: [] }], gone: [] },
  };
  assert.deepEqual(readRelations(raw, new Set(["g1", "g2"]), new Set(["a#0", "b#0"])), {
    links: [{ from: "g1", to: "g2", symbols: ["a"] }],
    flows: { g1: [{ from: "a#0", to: "b#0", symbols: ["x"] }] },
  });
  assert.equal(readRelations({ links: "no" }, new Set(), new Set()), null);
  assert.equal(readRelations(undefined, new Set(), new Set()), null);
});

test("Given a link that rests only on member names, then it is loose", () => {
  assert.equal(isLoose({ from: "g1", to: "g2", symbols: [".hide", ".tags"] }), true);
  assert.equal(isLoose({ from: "g1", to: "g2", symbols: ["TagFields", ".hide"] }), false);
});

test("Given a concern of fewer than three changes, then it has no flow", () => {
  const hunks = [hunk("a#0", ["x"], []), hunk("b#0", [], ["x"])];
  assert.deepEqual(relationsOf([concern("g1", ["a#0", "b#0"])], new Map(hunks.map((h) => [h.hunk.id, h]))).flows, {});
});

test("Given linked and unlinked concerns, then the map draws the linked ones, merges both directions, and puts the rest apart", async () => {
  const { layoutRelations } = await import("../diagram.js");
  const items = ["g1", "g2", "g3", "g4"].map((id) => ({ id, title: `Concern ${id}`, subtitle: "2 changes" }));
  const map = layoutRelations(
    items,
    [
      { from: "g1", to: "g2", symbols: ["TagFields"] },
      { from: "g2", to: "g1", symbols: ["AdoTagStore"] },
      { from: "g2", to: "g3", symbols: [".hide"] },
    ],
    { width: 700 },
  );
  assert.ok(map);
  assert.deepEqual(map.nodes.map((n) => n.id).sort(), ["g1", "g2"]);
  // g2 to g3 rests on a member name only: not drawn, so g3 is apart with g4.
  assert.deepEqual(map.apart.map((n) => n.id), ["g3", "g4"]);
  assert.deepEqual(map.edges.map((e) => [e.from, e.to, e.both, e.symbols]), [["g1", "g2", true, ["TagFields", "AdoTagStore"]]]);
  assert.equal(map.edges[0].reversed, false);
  for (const n of [...map.nodes, ...map.apart]) assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.width <= map.width && n.y + n.height <= map.height, n.id);
});

/** The level runs of a connector's path, as [x1, x2, y]. The layout only writes M, H, V and Q. */
function levelRuns(path: string): [number, number, number][] {
  const runs: [number, number, number][] = [];
  let x = 0;
  let y = 0;
  for (const [, command, args] of path.matchAll(/([MHVQ])([^MHVQ]*)/g)) {
    const n = args.trim().split(/[ ,]+/).map(Number);
    if (command === "M") [x, y] = n;
    else if (command === "H") {
      runs.push([Math.min(x, n[0]), Math.max(x, n[0]), y]);
      x = n[0];
    } else if (command === "V") y = n[0];
    else [x, y] = [n[2], n[3]];
  }
  return runs;
}

test("Given a chain of uses, then each card sits one column right of what it uses", async () => {
  const { layoutRelations } = await import("../diagram.js");
  const items = ["a", "b", "c"].map((id) => ({ id, title: id, subtitle: "file.ts", adds: 4, dels: 1 }));
  const map = layoutRelations(items, [{ from: "a", to: "b", symbols: ["x"] }, { from: "b", to: "c", symbols: ["y"] }], { width: 700 })!;
  const at = (id: string) => map.nodes.find((n) => n.id === id)!;
  assert.ok(at("a").x + at("a").width < at("b").x && at("b").x + at("b").width < at("c").x);
  assert.deepEqual([at("a").adds, at("a").dels], [4, 1]);
  // Every connector starts on its source's right edge and ends on its user's left edge.
  for (const edge of map.edges) {
    const runs = levelRuns(edge.path);
    assert.equal(runs[0][0], at(edge.from).x + at(edge.from).width, edge.from);
    assert.equal(runs.at(-1)![1], at(edge.to).x, edge.to);
  }
});

test("Given a connector that spans a column, then it passes clear of the card in between", async () => {
  const { layoutRelations } = await import("../diagram.js");
  const items = ["a", "b", "c"].map((id) => ({ id, title: id, subtitle: null }));
  const links = [{ from: "a", to: "b", symbols: ["x"] }, { from: "b", to: "c", symbols: ["y"] }, { from: "a", to: "c", symbols: ["z"] }];
  const map = layoutRelations(items, links, { width: 700 })!;
  const b = map.nodes.find((n) => n.id === "b")!;
  const long = map.edges.find((e) => e.from === "a" && e.to === "c")!;
  const across = levelRuns(long.path).filter(([x1, x2]) => x1 < b.x + b.width && x2 > b.x);
  assert.ok(across.length > 0);
  for (const [, , y] of across) assert.ok(y < b.y || y > b.y + b.height, `the connector crosses b at y=${y}`);
});

test("Given uses that form a cycle, then the map still lays out, and the use that closes it is drawn back to front", async () => {
  const { layoutRelations } = await import("../diagram.js");
  const items = ["a", "b", "c"].map((id) => ({ id, title: id, subtitle: null }));
  const links = [{ from: "a", to: "b", symbols: ["x"] }, { from: "b", to: "c", symbols: ["y"] }, { from: "c", to: "a", symbols: ["z"] }];
  const map = layoutRelations(items, links, { width: 700 })!;
  assert.equal(map.nodes.length, 3);
  assert.equal(new Set(map.nodes.map((n) => n.x)).size, 3);
  assert.equal(map.edges.filter((e) => e.reversed).length, 1);
});

test("Given an arrow whose only name is the title of the box it comes from, then it has no label", async () => {
  const { layoutRelations } = await import("../diagram.js");
  const items = [{ id: "a", title: "StorageCleanup", subtitle: "storageCleanup.ts" }, { id: "b", title: "make", subtitle: "storageCleanup.ts" }, { id: "c", title: "sentence", subtitle: null }];
  const map = layoutRelations(items, [{ from: "a", to: "b", symbols: ["StorageCleanup"] }, { from: "c", to: "b", symbols: ["sentence", "Reason", "kind"] }], { width: 700 });
  assert.deepEqual(map!.edges.map((e) => [e.from, e.label?.text ?? null]).sort(), [["a", null], ["c", "Reason +1"]]);
});

test("Given a name defined both in the user's own file and in another, then it links only to its own file", () => {
  const hunks = [hunk("src/env.ts#0", ["make"], []), hunk("src/cleanup.ts#0", ["make"], []), hunk("src/cleanup.ts#1", ["layer"], ["make"])];
  const relations = relationsOf([concern("g1", hunks.map((h) => h.hunk.id))], new Map(hunks.map((h) => [h.hunk.id, h])));
  assert.deepEqual(relations.flows.g1, [{ from: "src/cleanup.ts#0", to: "src/cleanup.ts#1", symbols: ["make"] }]);
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
    ...ids.slice(0, 3).map((from) => ({ from, to: "src/layer.ts#0", symbols: ["make"] })),
    { from: "src/cleanup.ts#0", to: "src/cleanup.ts#2", symbols: ["reason"] },
    { from: "src/env.ts#0", to: "src/layer.ts#0", symbols: ["make"] },
  ];
  const flow = concernFlow(concern("g1", ids), { links: [], flows: { g1: links } }, hunks);
  // Every box: the function, then its file and count. The link inside the first box is left out.
  assert.deepEqual(flow.boxes.map((b) => [b.title, b.subtitle, b.hunkIds.length]).sort(), [
    ["StorageLayer", "layer.ts", 1],
    ["make", "cleanup.ts · 3 changes", 3],
    ["make", "env.ts", 1],
  ]);
  assert.equal(flow.links.length, 2);
  // The arrow from the cleanup.ts box involves only the changes that use make there, not the whole box.
  const { pairKey } = await import("../flow.js");
  const cleanup = flow.boxes.find((b) => b.subtitle === "cleanup.ts · 3 changes")!.id;
  const layer = flow.boxes.find((b) => b.title === "StorageLayer")!.id;
  assert.deepEqual(flow.arrowHunks[pairKey(cleanup, layer)], ["src/cleanup.ts#0", "src/cleanup.ts#1", "src/cleanup.ts#2", "src/layer.ts#0"]);
  assert.equal(flow.tooMany, false);
  assert.equal(flow.unlinked, 0);
});

test("Given more boxes than a map can show, then the flow says so instead of drawing them", async () => {
  const { concernFlow, MAX_FLOW_BOXES } = await import("../flow.js");
  const ids = Array.from({ length: MAX_FLOW_BOXES + 1 }, (_, i) => `src/f${i}.ts#0`);
  const hunks = new Map([["src/def.ts#0", inFile("src/def.ts#0", "src/def.ts", "def")], ...ids.map((id, i) => [id, inFile(id, `src/f${i}.ts`, `user${i}`)] as const)]);
  const links = ids.map((to) => ({ from: "src/def.ts#0", to, symbols: ["def"] }));
  const flow = concernFlow(concern("g1", ["src/def.ts#0", ...ids]), { links: [], flows: { g1: links } }, hunks);
  assert.equal(flow.tooMany, true);
});
