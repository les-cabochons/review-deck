import { html as diffToHtml } from "diff2html";
import type { FileDiff, Group, HunkInfo, PairScore, ReviewResult, SignalName } from "../core/types.js";
import { fileToPatch, hunkToPatch } from "../diff/parse.js";

export interface RenderAssets {
  /** Contents of diff2html.min.css, inlined so the page is self-contained. */
  diff2htmlCss: string;
}

const SIGNALS: SignalName[] = ["structural", "testPairing", "lexical", "semantic", "path"];
const SIGNAL_LABEL: Record<SignalName, string> = {
  structural: "struct",
  testPairing: "test",
  lexical: "lexical",
  semantic: "semantic",
  path: "path",
};
const PALETTE = ["#2563eb", "#d97706", "#059669", "#db2777", "#7c3aed", "#0891b2", "#65a30d", "#dc2626"];

/** Renders one self-contained HTML page for a review result. Browser-safe. */
export function renderReport(result: ReviewResult, assets: RenderAssets): string {
  const groupOf = new Map<string, Group>();
  result.groups.forEach((g) => g.hunkIds.forEach((id) => groupOf.set(id, g)));
  const color = new Map(result.groups.map((g, i) => [g.id, g.kind === "semantic" ? PALETTE[i % PALETTE.length] : "#6b7280"]));
  const number = new Map(result.groups.map((g, i) => [g.id, i + 1]));
  const ctx: Ctx = { result, groupOf, color, number };

  const reviewable = [...result.hunks.values()].filter((h) => !h.mechanical).length;
  const stats = [
    `${result.files.length} files`,
    `${result.hunks.size} hunks`,
    `${result.groups.filter((g) => g.kind === "semantic").length} groups`,
    `${result.hunks.size - reviewable} mechanical`,
    `signals: ${SIGNALS.filter((s) => s !== "semantic" || result.options.semantic).join(", ")}`,
    `titles: ${result.options.titler}`,
  ];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(result.title)} · Review Deck</title>
<style>${assets.diff2htmlCss}</style>
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <div class="title-row">
    <h1>${esc(result.title)}</h1>
    <nav class="tabs" role="tablist">
      <button class="tab active" data-view="grouped">Grouped</button>
      <button class="tab" data-view="files">By file (A–Z)</button>
      <button class="tab" data-view="debug">Debug</button>
    </nav>
  </div>
  <p class="desc">${esc(result.description)}</p>
  <p class="stats">${stats.map(esc).join(" · ")}</p>
  ${result.warnings.map((w) => `<p class="warning">⚠ ${esc(w)}</p>`).join("")}
</header>
<main>
  <section class="view" id="view-grouped">
    <div class="toolbar"><button data-toggle-all="grouped">Collapse all</button></div>
    ${result.groups.map((g) => renderGroup(g, ctx)).join("\n")}
  </section>
  <section class="view hidden" id="view-files">
    <div class="toolbar"><button data-toggle-all="files">Collapse all</button></div>
    ${[...result.files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => renderFile(f, ctx)).join("\n")}
  </section>
  <section class="view hidden" id="view-debug">${renderDebug(ctx)}</section>
</main>
<script>${SCRIPT}</script>
</body>
</html>`;
}

interface Ctx {
  result: ReviewResult;
  groupOf: Map<string, Group>;
  color: Map<string, string>;
  number: Map<string, number>;
}

function renderGroup(g: Group, ctx: Ctx): string {
  const hunks = g.hunkIds.map((id) => ctx.result.hunks.get(id)!);
  const files = new Set(hunks.map((h) => h.file.path)).size;
  const open = g.kind !== "mechanical";
  return `<details class="group kind-${g.kind}" id="group-${g.id}" ${open ? "open" : ""} style="--c:${ctx.color.get(g.id)}">
  <summary>
    <span class="badge">${ctx.number.get(g.id)}</span>
    <span class="gtitle">${esc(g.title)}</span>
    <span class="count">${hunks.length} hunk${hunks.length === 1 ? "" : "s"} · ${files} file${files === 1 ? "" : "s"}</span>
  </summary>
  <p class="rationale">${esc(g.rationale)}</p>
  ${hunks.map((h, i) => renderHunk(h, ctx, i + 1)).join("\n")}
</details>`;
}

function renderHunk(h: HunkInfo, ctx: Ctx, position: number): string {
  const tags = [
    h.isTest ? `<span class="tag test">test</span>` : "",
    h.mechanical ? `<span class="tag mech">${esc(h.mechanical.reason)}</span>` : "",
    h.commentOnly ? `<span class="tag">comment-only</span>` : "",
  ].join("");
  const links = neighbors(h.hunk.id, ctx)
    .filter((n) => ctx.groupOf.get(n.other) === ctx.groupOf.get(h.hunk.id))
    .slice(0, 4)
    .map((n) => `<a class="link" href="#hunk-${attr(n.other)}" title="${attr(n.evidence)}">${esc(n.other)} <b>${n.weight.toFixed(2)}</b></a>`)
    .join("");
  return `<article class="hunk" id="hunk-${attr(h.hunk.id)}">
  <div class="hunk-head">
    <span class="pos">${position}</span>
    <code class="hid">${esc(h.hunk.id)}</code>
    ${h.symbol ? `<code class="sym">${esc(h.symbol)}</code>` : ""}
    ${tags}
    ${links ? `<span class="links">linked: ${links}</span>` : ""}
  </div>
  ${diffToHtml(hunkToPatch(h.file, h.hunk), { drawFileList: false, outputFormat: "line-by-line", matching: "lines" })}
</article>`;
}

function renderFile(f: FileDiff, ctx: Ctx): string {
  const badges = f.hunks
    .map((hk) => {
      const g = ctx.groupOf.get(hk.id)!;
      return `<a class="gbadge" style="--c:${ctx.color.get(g.id)}" href="#hunk-${attr(hk.id)}" data-goto-grouped title="${attr(g.title)}">#${hk.index} → ${ctx.number.get(g.id)}</a>`;
    })
    .join("");
  return `<details class="file" open>
  <summary><code>${esc(f.path)}</code> <span class="count">${f.status}${f.hunks[0]?.header ? ` · ${f.hunks.length} hunk${f.hunks.length === 1 ? "" : "s"}` : ""}</span> ${badges}</summary>
  ${diffToHtml(fileToPatch(f), { drawFileList: false, outputFormat: "line-by-line", matching: "lines" })}
</details>`;
}

function neighbors(id: string, ctx: Ctx): { other: string; weight: number; evidence: string }[] {
  return ctx.result.pairs
    .filter((p) => (p.a === id || p.b === id) && p.weight >= ctx.result.options.minEdgeWeight)
    .map((p) => ({ other: p.a === id ? p.b : p.a, weight: p.weight, evidence: evidenceText(p) }))
    .sort((a, b) => b.weight - a.weight);
}

function evidenceText(p: PairScore): string {
  return SIGNALS.filter((s) => p.signals[s])
    .map((s) => `${SIGNAL_LABEL[s]} ${p.signals[s]!.score.toFixed(2)}: ${p.signals[s]!.evidence.join("; ")}`)
    .join("\n");
}

function renderDebug(ctx: Ctx): string {
  const { result } = ctx;
  const w = result.options.weights;
  const pairs = [...result.pairs].sort((a, b) => b.weight - a.weight);
  const rows = pairs
    .map((p) => {
      const ga = ctx.groupOf.get(p.a)!;
      const gb = ctx.groupOf.get(p.b)!;
      const same = ga === gb && ga.kind === "semantic";
      const edge = p.weight >= result.options.minEdgeWeight;
      const cells = SIGNALS.map((s) => {
        const sc = p.signals[s];
        if (!sc) return `<td class="num empty">·</td>`;
        return `<td class="num" style="--a:${Math.min(1, sc.score).toFixed(2)}" title="${attr(sc.evidence.join("\n"))}">${sc.score.toFixed(2)}</td>`;
      }).join("");
      return `<tr class="${edge ? "edge" : "weak"} ${same ? "same" : ""}">
  <td><a href="#hunk-${attr(p.a)}" data-goto-grouped><code>${esc(p.a)}</code></a></td>
  <td><a href="#hunk-${attr(p.b)}" data-goto-grouped><code>${esc(p.b)}</code></a></td>
  ${cells}
  <td class="num total">${p.weight.toFixed(2)}</td>
  <td>${edge ? "edge" : "below"}${same ? " · same group" : ga.kind === "semantic" && gb.kind === "semantic" ? " · <b>cross</b>" : ""}</td>
  <td class="ev">${esc(SIGNALS.flatMap((s) => p.signals[s]?.evidence ?? []).join("; "))}</td>
</tr>`;
    })
    .join("\n");

  const hunkRows = [...result.hunks.values()]
    .map((h) => {
      const g = ctx.groupOf.get(h.hunk.id)!;
      return `<tr>
  <td><a href="#hunk-${attr(h.hunk.id)}" data-goto-grouped><code>${esc(h.hunk.id)}</code></a></td>
  <td><span class="gbadge" style="--c:${ctx.color.get(g.id)}">${ctx.number.get(g.id)}</span></td>
  <td><code>${esc(h.symbol ?? "")}</code></td>
  <td class="ev">${esc([...h.defines].join(", "))}</td>
  <td class="ev">${esc([...h.impacts].join(", "))}</td>
  <td class="ev">${esc([...h.references].slice(0, 12).join(", "))}${h.references.size > 12 ? "…" : ""}</td>
  <td class="ev">${esc(h.mechanical?.reason ?? "")}</td>
</tr>`;
    })
    .join("\n");

  return `<div class="debug">
  <h2>Pair scores</h2>
  <p class="note">Edge weight = ${SIGNALS.map((s) => `${w[s]}×${SIGNAL_LABEL[s]}`).join(" + ")}${result.options.semantic ? "" : " (semantic disabled)"}.
  Pairs at or above ${result.options.minEdgeWeight} become graph edges for Louvain clustering. Hover a score for its evidence. Mechanical hunks are not scored.</p>
  <input class="filter" placeholder="Filter pairs (hunk id, symbol, signal)…" data-filter="pairs">
  <label class="chk"><input type="checkbox" data-hide-weak checked> hide pairs below threshold</label>
  <table class="pairs hide-weak" id="pairs">
    <thead><tr><th>hunk A</th><th>hunk B</th>${SIGNALS.map((s) => `<th class="num">${SIGNAL_LABEL[s]}<br><small>×${w[s]}</small></th>`).join("")}<th class="num">weight</th><th>status</th><th>evidence</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${
    result.merges.length
      ? `<h2>Post-clustering merges</h2><ul>${result.merges.map((m) => `<li><code>${esc(m.from)}</code> uses <code>${esc(m.symbol)}</code> introduced by <code>${esc(m.into)}</code></li>`).join("")}</ul>`
      : ""
  }
  <h2>Hunk facts</h2>
  <table class="facts">
    <thead><tr><th>hunk</th><th>group</th><th>symbol</th><th>defines</th><th>impacts</th><th>references</th><th>mechanical</th></tr></thead>
    <tbody>${hunkRows}</tbody>
  </table>
  <h2>Timings (ms)</h2>
  <p class="note">${Object.entries(result.timings).map(([k, v]) => `${esc(k)} ${v}`).join(" · ")}</p>
</div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const attr = esc;

const CSS = `
:root { --fg:#1f2328; --muted:#656d76; --line:#d0d7de; --bg:#f6f8fa; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
body { margin:0; color:var(--fg); background:#fff; }
header.top { position:sticky; top:0; z-index:5; background:#fff; border-bottom:1px solid var(--line); padding:12px 24px 8px; }
.title-row { display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
h1 { font-size:20px; margin:0; flex:1; }
.desc { margin:6px 0 2px; color:var(--muted); font-size:14px; max-width:110ch; }
.stats { margin:2px 0; font-size:12px; color:var(--muted); }
.warning { margin:4px 0; font-size:13px; color:#9a6700; }
.tabs { display:flex; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
.tab { border:0; background:#fff; padding:6px 14px; font:inherit; font-size:13px; cursor:pointer; border-right:1px solid var(--line); }
.tab:last-child { border-right:0; }
.tab.active { background:var(--fg); color:#fff; }
main { padding:16px 24px 64px; }
.hidden { display:none; }
.toolbar { display:flex; justify-content:flex-end; margin-bottom:8px; }
.toolbar button { font:inherit; font-size:12px; padding:4px 10px; border:1px solid var(--line); border-radius:6px; background:#fff; cursor:pointer; }
details.group { border:1px solid var(--line); border-left:4px solid var(--c); border-radius:8px; margin:0 0 16px; background:#fff; }
details.group > summary { list-style:none; cursor:pointer; padding:10px 14px; display:flex; align-items:center; gap:10px; background:var(--bg); border-radius:8px 8px 0 0; }
details.group:not([open]) > summary { border-radius:8px; }
details.group > summary::-webkit-details-marker { display:none; }
details.group > summary::before { content:"▸"; color:var(--muted); transition:transform .1s; }
details.group[open] > summary::before { transform:rotate(90deg); }
.badge { background:var(--c); color:#fff; border-radius:999px; min-width:22px; height:22px; display:inline-flex; align-items:center; justify-content:center; font-size:12px; font-weight:600; }
.gtitle { font-weight:600; font-size:15px; flex:1; }
.count { color:var(--muted); font-size:12px; white-space:nowrap; }
.kind-mechanical .gtitle, .kind-misc .gtitle { color:var(--muted); }
.rationale { margin:0; padding:8px 14px 4px; font-size:13px; color:var(--muted); }
.hunk { margin:10px 14px 14px; }
.hunk-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:12px; margin-bottom:4px; }
.pos { color:var(--muted); font-variant-numeric:tabular-nums; }
.hid { font-weight:600; }
.sym { background:#eef2ff; color:#3730a3; padding:1px 6px; border-radius:4px; }
.tag { border:1px solid var(--line); border-radius:999px; padding:0 8px; color:var(--muted); }
.tag.test { border-color:#a7f3d0; color:#047857; }
.tag.mech { border-color:#e5e7eb; }
.links { color:var(--muted); display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
.link { color:var(--muted); text-decoration:none; border:1px dashed var(--line); border-radius:4px; padding:0 6px; font-family:ui-monospace, monospace; font-size:11px; }
.link b { color:var(--fg); font-weight:600; }
.link:hover { border-color:var(--fg); }
.hunk .d2h-file-wrapper { margin-bottom:0; border-radius:6px; }
.hunk:target .d2h-file-wrapper { outline:2px solid #f59e0b; }
details.file { border:1px solid var(--line); border-radius:8px; margin:0 0 12px; }
details.file > summary { padding:8px 12px; cursor:pointer; background:var(--bg); display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
details.file .d2h-file-header { display:none; }
details.file .d2h-file-wrapper { margin:0; border:0; border-top:1px solid var(--line); border-radius:0; }
.gbadge { background:var(--c); color:#fff; border-radius:4px; padding:0 6px; font-size:11px; text-decoration:none; font-weight:600; }
.debug h2 { font-size:16px; margin:24px 0 6px; }
.note { font-size:12px; color:var(--muted); max-width:120ch; }
.filter { font:inherit; font-size:13px; padding:6px 10px; border:1px solid var(--line); border-radius:6px; width:360px; }
.chk { font-size:12px; color:var(--muted); margin-left:12px; }
.debug table { border-collapse:collapse; font-size:12px; margin-top:8px; width:100%; }
.debug th, .debug td { border-bottom:1px solid #eaeef2; padding:4px 8px; text-align:left; vertical-align:top; }
.debug th { position:sticky; top:96px; background:#fff; font-weight:600; cursor:pointer; }
.debug td.num, .debug th.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
.debug td.num { background:rgba(37, 99, 235, calc(var(--a, 0) * 0.35)); }
.debug td.num.empty { background:none; color:#c4c9cf; }
.debug td.total { font-weight:600; background:none; }
.debug td.ev { color:var(--muted); max-width:520px; }
.debug tr.weak { opacity:.55; }
.debug table.hide-weak tr.weak { display:none; }
.debug tr.same td:first-child { box-shadow: inset 3px 0 #059669; }
`;

const SCRIPT = `
const views = ["grouped", "files", "debug"];
function show(view) {
  for (const v of views) document.getElementById("view-" + v).classList.toggle("hidden", v !== view);
  for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t.dataset.view === view);
}
for (const t of document.querySelectorAll(".tab")) t.addEventListener("click", () => show(t.dataset.view));
for (const a of document.querySelectorAll("[data-goto-grouped]")) a.addEventListener("click", () => {
  show("grouped");
  const target = document.querySelector(a.getAttribute("href"));
  const group = target && target.closest("details");
  if (group) group.open = true;
});
for (const b of document.querySelectorAll("[data-toggle-all]")) b.addEventListener("click", () => {
  const items = document.querySelectorAll("#view-" + b.dataset.toggleAll + " > details");
  const collapse = b.textContent.startsWith("Collapse");
  items.forEach((d) => (d.open = !collapse));
  b.textContent = collapse ? "Expand all" : "Collapse all";
});
const filter = document.querySelector("[data-filter=pairs]");
filter.addEventListener("input", () => {
  const q = filter.value.toLowerCase();
  for (const tr of document.querySelectorAll("#pairs tbody tr")) tr.style.display = tr.textContent.toLowerCase().includes(q) ? "" : "none";
});
document.querySelector("[data-hide-weak]").addEventListener("change", (e) => document.getElementById("pairs").classList.toggle("hide-weak", e.target.checked));
for (const table of document.querySelectorAll(".debug table")) {
  table.querySelectorAll("th").forEach((th, col) => th.addEventListener("click", () => {
    const body = table.tBodies[0];
    const rows = [...body.rows];
    const num = th.classList.contains("num");
    const dir = th.dataset.dir === "desc" ? 1 : -1;
    th.dataset.dir = dir === 1 ? "asc" : "desc";
    rows.sort((a, b) => {
      const x = a.cells[col].textContent, y = b.cells[col].textContent;
      return num ? dir * ((parseFloat(x) || 0) - (parseFloat(y) || 0)) : -dir * x.localeCompare(y);
    });
    rows.forEach((r) => body.appendChild(r));
  }));
}
`;
