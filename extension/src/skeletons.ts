/**
 * What the pages look like before their data arrives, as HTML strings, so one markup paints from three places:
 * the static page (extension/build.mjs inlines the hub's into review.html, so it shows before any script runs),
 * the entry script once the route is known (src/index.ts swaps in a pull request's), and React while a page's
 * data loads. The skeletons use the real pages' classes, so the real page replaces them in place without a jump.
 *
 * No imports: this module is bundled into the small entry chunk and evaluated by the build.
 */

/** Where src/startup.ts keeps the host's theme for the next load; `themeBootScript` reads it. */
export const THEME_KEY = "review-deck.theme";

/** What the hub already knows about a pull request, shown for real in its skeleton; everything else is gray. */
export interface PrSkeletonHint {
  id: number;
  title?: string;
  /** Repository name, for the breadcrumb. */
  repo?: string;
  author?: { displayName: string; imageUrl?: string };
  sourceBranch?: string;
  targetBranch?: string;
  status?: "active" | "draft" | "completed" | "abandoned";
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const bar = (width: string, extra = "") => `<span class="skeleton-bar${extra ? ` ${extra}` : ""}" style="width:${width}"></span>`;
const pill = (width: number, extra = "") => `<span class="skeleton-pill${extra ? ` ${extra}` : ""}" style="width:${width}px"></span>`;

/** Row widths, as percentages, so the placeholder list looks like titles of different lengths. */
const ROW_WIDTHS = [62, 48, 71, 55, 40, 66];
const SECTIONS = ["Needs your review", "Returned to you", "Approved", "Waiting for review", "Drafts", "You reviewed", "Recently completed", "Other active"];
const STATUS_LABEL: Record<NonNullable<PrSkeletonHint["status"]>, string> = { active: "Active", draft: "Draft", completed: "Completed", abandoned: "Abandoned" };

/** Placeholder rows for a hub with nothing cached yet (also the React hub's, through ui/hub/HubPage.tsx). */
export function hubRowsSkeleton(label = "Loading pull requests…"): string {
  const rows = ROW_WIDTHS.map((w) => `<div class="skeleton-row"><span class="skeleton-dot"></span><span class="skeleton-lines">${bar(`${w}%`)}${bar(`${w / 2}%`, "short")}</span></div>`).join("");
  return `<section class="inbox-section skeleton" aria-busy="true" aria-label="${esc(label)}"><div class="inbox-section-header muted">${esc(label)}</div><div class="pr-rows">${rows}</div></section>`;
}

/** The hub before React: its sidebar, toolbar and placeholder rows, in the hub's own layout. */
export function hubSkeleton(): string {
  const item = (text: string, active = false) => `<div class="hub-nav-item${active ? " active" : ""}"><span class="hub-nav-icon skeleton-icon"></span><span class="text">${esc(text)}</span></div>`;
  return (
    `<div class="hub skeleton-page" aria-busy="true" aria-label="Loading pull requests">` +
    `<aside class="hub-sidebar"><nav aria-label="Inbox sections">${item("Inbox", true)}<div class="hub-sidebar-sep"></div>${SECTIONS.map((s) => item(s)).join("")}</nav>` +
    `<div class="hub-sidebar-sep"></div><section class="hub-tags" aria-label="Tags"><div class="hub-tags-head"><span>Tags</span></div></section></aside>` +
    `<main class="hub-main"><div class="hub-toolbar"><div class="search-box"><span class="skeleton-icon"></span>${bar("45%")}</div>${pill(132)}${pill(32)}<span class="spacer"></span>${pill(128, "primary")}</div>${hubRowsSkeleton()}</main>` +
    `</div>`
  );
}

/** A pull request's header, tabs and an empty overview; the breadcrumb is the caller's (React makes it a link back). */
export function prSkeletonBody(hint: PrSkeletonHint): string {
  const title = hint.title ? esc(hint.title) : bar("55%", "skeleton-h1");
  const status = hint.status ? `<span class="status-pill status-${hint.status}">${STATUS_LABEL[hint.status]}</span>` : pill(72, "small");
  const avatar = hint.author?.imageUrl
    ? `<img class="avatar" src="${esc(hint.author.imageUrl)}" width="20" height="20" alt="" title="${esc(hint.author.displayName)}">`
    : `<span class="avatar skeleton-dot small"></span>`;
  const author = hint.author ? `<strong>${esc(hint.author.displayName)}</strong>` : bar("96px");
  const branch = (name?: string) => (name ? `<span class="branch">${esc(name)}</span>` : bar("88px"));
  return (
    `<header class="pr-header"><div class="pr-title-row"><h1>${title} <span class="pr-id">!${hint.id}</span></h1>` +
    `<div class="pr-actions">${pill(96)}${pill(104)}${pill(112, "primary")}${pill(32)}</div></div>` +
    `<div class="pr-meta">${status}${avatar}${author}<span class="muted">wants to merge</span>${branch(hint.sourceBranch)}<span class="muted">into</span>${branch(hint.targetBranch)}</div></header>` +
    `<div class="pr-tabs skeleton-tabs"><span class="skeleton-tab active">Overview</span><span class="skeleton-tab">Files</span><span class="skeleton-tab">Commits</span></div>` +
    `<main class="tab-content"><div class="overview"><div class="overview-main">${bar("40%", "skeleton-h2")}${bar("92%")}${bar("84%")}${bar("60%")}</div>` +
    `<div class="overview-side">${bar("50%", "skeleton-h2")}${bar("70%")}${bar("65%")}</div></div></main>`
  );
}

/** A pull request before React, with a plain-text breadcrumb. */
export function prSkeleton(hint: PrSkeletonHint): string {
  const repo = hint.repo ? `<span class="crumb-sep">/</span><span class="crumb">${esc(hint.repo)}</span>` : "";
  return (
    `<div class="review-page skeleton-page" aria-busy="true" aria-label="Loading pull request">` +
    `<nav class="breadcrumb" aria-label="Breadcrumb"><span class="crumb-link">Pull requests</span>${repo}<span class="crumb-sep">/</span><span class="crumb">!${hint.id}</span></nav>` +
    prSkeletonBody(hint) +
    `</div>`
  );
}

/** Project settings → Review Deck before React. */
export function settingsSkeleton(): string {
  const section = (title: string) => `<section class="settings-section"><h2>${esc(title)}</h2>${bar("70%")}${bar("40%")}</section>`;
  return (
    `<div class="settings-page skeleton-page" aria-busy="true" aria-label="Loading settings">` +
    `<header class="settings-header"><h1>Review Deck</h1><p class="muted">Settings for this project's pull request hub and review page.</p></header>` +
    section("Stacked pull requests") +
    section("AI group titles") +
    `</div>`
  );
}

/**
 * Inline script for the static pages: applies the theme variables the host sent last time (src/startup.ts keeps
 * them under THEME_KEY) before the first paint, so a dark-theme user's skeleton is dark rather than flashing light.
 * The host's own theme, applied by the SDK during the handshake, takes over as soon as it arrives.
 */
export function themeBootScript(): string {
  return (
    `(function(){try{var t=JSON.parse(localStorage.getItem(${JSON.stringify(THEME_KEY)})||"null");if(!t||typeof t!=="object")return;` +
    `var v=[];for(var k in t)if(/^[\\w-]+$/.test(k))v.push("--"+k+":"+String(t[k]).replace(/[;{}]/g,""));` +
    `var s=document.createElement("style");s.textContent=":root{"+v.join(";")+"}body{color:var(--text-primary-color)}";document.head.appendChild(s)}catch(e){}})();`
  );
}
