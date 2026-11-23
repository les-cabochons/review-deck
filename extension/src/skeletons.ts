/**
 * What the pages look like before their data arrives, as HTML strings, so one markup paints from three places:
 * the static page (extension/build.mjs inlines the hub's into review.html, so it shows before any script runs),
 * the entry script once the route is known (src/index.ts swaps in a pull request's), and React while a page's
 * data loads. Each skeleton is the loaded page's own markup (its classes, icons, buttons and fixed labels), with a
 * gray bar only where data goes, so the loaded page fills it in place instead of replacing a different layout.
 * review.css already holds azure-devops-ui's button, tab and icon styles, so this markup paints right before React.
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

/**
 * The hub's sections with their sidebar icons, as data/list.ts SECTION_META and SECTION_ORDER have them (copied,
 * since this module has no imports; tests/skeletons.test.ts checks they match).
 */
export const HUB_SECTIONS: { id: string; title: string; icon: string }[] = [
  { id: "needs-review", title: "Needs your review", icon: "ReviewSolid" },
  { id: "returned", title: "Returned to you", icon: "Reply" },
  { id: "approved", title: "Approved", icon: "CompletedSolid" },
  { id: "waiting", title: "Waiting for review", icon: "Clock" },
  { id: "drafts", title: "Drafts", icon: "EditNote" },
  { id: "reviewed", title: "You reviewed", icon: "Accept" },
  { id: "completed", title: "Recently completed", icon: "BranchMerged" },
  { id: "other", title: "Other active", icon: "BranchPullRequest" },
];

/** Where ui/preferences.ts keeps a preference in this browser (readLocal). */
const preferenceKey = (key: string) => `semantic-review.${key}`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** azure-devops-ui's Icon, as it renders: the glyph comes from review.css and its icon font. */
const icon = (name: string, extra = "") => `<span class="fluent-icons-enabled"><span aria-hidden="true" class="${extra ? `${extra} ` : ""}flex-noshrink fabric-icon ms-Icon--${name}"></span></span>`;
const bar = (width: string, extra = "") => `<span class="skeleton-bar${extra ? ` ${extra}` : ""}" style="width:${width}"></span>`;
/** A gray circle where an avatar goes. */
const avatar = (size: number) => `<span class="avatar skeleton-dot" style="width:${size}px;height:${size}px"></span>`;
const status = (s: NonNullable<PrSkeletonHint["status"]>) => {
  const label = { active: "Active", draft: "Draft", completed: "Completed", abandoned: "Abandoned" }[s];
  // As ui/App.tsx STATUS has them.
  const glyph = { active: "BranchPullRequest", draft: "BranchRequestDraft", completed: "BranchMerged", abandoned: "BranchRequestClosed" }[s];
  return `<span class="status-pill status-${s}">${icon(glyph)} ${label}</span>`;
};

/** A disabled azure-devops-ui Button, as the PR page's header shows its actions until they work. */
const button = (text: string, opts: { icon?: string; primary?: boolean } = {}) =>
  `<button aria-disabled="true" class="bolt-button${opts.icon ? " bolt-icon-button" : ""} disabled${opts.primary ? " primary" : ""} bolt-focus-treatment" tabindex="-1" type="button">` +
  `${opts.icon ? icon(opts.icon, "left-icon medium") : ""}<span class="bolt-button-text body-m">${text}</span></button>`;
const splitButton = (text: string, opts: { icon?: string; primary?: boolean; className?: string } = {}) => {
  const primary = opts.primary ? " primary" : "";
  return (
    `<div class="${opts.className ? `${opts.className} ` : ""}bolt-split-button flex-stretch inline-flex-row">` +
    `<button aria-disabled="true" class="bolt-split-button-main bolt-button${opts.icon ? " bolt-icon-button" : ""} disabled${primary} bolt-focus-treatment" tabindex="-1" type="button">` +
    `${opts.icon ? icon(opts.icon, "left-icon medium") : ""}<span class="bolt-button-text body-m">${text}</span></button>` +
    `<div class="bolt-split-button-divider flex-noshrink${primary}"></div>` +
    `<div class="inline-flex-row"><button aria-disabled="true" class="bolt-split-button-option flex-self-stretch body-s bolt-button bolt-icon-button disabled${primary} icon-only bolt-focus-treatment" tabindex="-1" type="button">${icon("ChevronDownMed", "left-icon small")}</button></div>` +
    `</div>`
  );
};

// ---------- hub ----------

/** Title widths of the placeholder rows, as percentages, so they read as titles of different lengths. */
const ROW_WIDTHS = [62, 48, 71, 55, 40, 66];

/** A hub row with nothing in it yet: the real row's cells (ui/hub/HubPage.tsx PrRow), so its grid places them. */
function rowSkeleton(width: number): string {
  return (
    `<div class="pr-row skeleton" aria-hidden="true">` +
    `<span class="pr-state"></span>${avatar(32)}` +
    `<div class="pr-main"><div class="pr-title">${bar(`${width}%`)}</div></div>` +
    `<div class="pr-sub-line"><div class="pr-sub">${bar(`${Math.round(width * 0.7)}%`, "short")}</div></div>` +
    `<span class="review-state">${bar("84px", "short")}</span>` +
    `<span class="reviewer-stack">${avatar(22)}</span>` +
    `<span class="pr-checks"><span class="dot-loading"></span></span>` +
    `<span class="pr-presence"></span><span class="pr-comments"></span>` +
    `<span class="pr-size">${bar("72px", "short")}</span>` +
    `<span class="pr-time">${bar("92px", "short")}</span>` +
    `<div class="pr-mobile"><div class="m-top">${avatar(20)}${bar("40%", "short")}</div><div class="m-title">${bar(`${width}%`)}</div></div>` +
    `</div>`
  );
}

/** A hub section loading its rows (also the React hub's, through ui/hub/HubPage.tsx): its header says what loads. */
export function hubRowsSkeleton(label = "Loading pull requests…"): string {
  return (
    `<section class="inbox-section skeleton" aria-busy="true" aria-label="${esc(label)}">` +
    `<div class="inbox-section-header">${icon("ChevronDown")}<span class="title muted">${esc(label)}</span></div>` +
    `<div class="pr-rows">${ROW_WIDTHS.map(rowSkeleton).join("")}</div></section>`
  );
}

/** A sidebar count that hasn't loaded: the count pill's place, in gray (also ui/hub/HubPage.tsx SidebarItem's). */
export const countSkeleton = `<span class="count-pill skeleton-count"></span>`;

/** The tags the sidebar lists, before they load (also ui/tags/Tags.tsx SidebarTags'). */
export function tagListSkeleton(): string {
  const tag = (width: number) => `<li><span class="hub-tag"><span class="tag-dot skeleton-dot"></span><span class="text">${bar(`${width}%`)}</span></span></li>`;
  return `<ul class="hub-tag-list" aria-busy="true" aria-label="Loading tags">${[58, 44, 66].map(tag).join("")}</ul>`;
}

/** The project and repository picker before its choices load (also ui/hub/HubPage.tsx's). */
export function repoPickerSkeleton(): string {
  return (
    `<div class="repo-picker-button bolt-expandable-button inline-flex-row">` +
    `<button aria-disabled="true" class="bolt-button bolt-icon-button disabled bolt-focus-treatment" tabindex="-1" type="button" aria-label="Choose projects and repositories">` +
    `${icon("Repo", "left-icon medium")}<span class="bolt-button-text body-m">${bar("72px")}</span>${icon("ChevronDownMed", "icon-right font-weight-normal small")}</button></div>`
  );
}

/**
 * The hub before React: its sidebar (icons, labels, gray counts), toolbar and a loading section, in the hub's own
 * markup. The script after it applies the sidebar preferences this browser kept (folded to icons, the chosen
 * section), as HubPage reads them, so the sidebar doesn't change shape when React takes over.
 */
export function hubSkeleton(): string {
  const item = (id: string, text: string, glyph: string) =>
    `<div class="hub-nav-item" data-filter="${id}">${icon(glyph, "hub-nav-icon")}<span class="text">${esc(text)}</span>${countSkeleton}</div>`;
  const preferences =
    `(function(){try{var hub=document.querySelector(".hub.skeleton-page");var get=function(k){return localStorage.getItem(${JSON.stringify(preferenceKey(""))}+k)};` +
    `if(get("hub.sidebar")==="rail"){hub.classList.add("rail");var t=hub.querySelector(".hub-sidebar-toggle .fabric-icon");t.classList.replace("ms-Icon--DoubleChevronLeft","ms-Icon--DoubleChevronRight")}` +
    `var f=get("hub.filter")||"inbox";var item=hub.querySelector('.hub-nav-item[data-filter="'+f+'"]')||hub.querySelector(".hub-nav-item");item.classList.add("active")}catch(e){}})();`;
  return (
    `<div class="hub skeleton-page" aria-busy="true" aria-label="Loading pull requests">` +
    `<aside class="hub-sidebar"><nav aria-label="Inbox sections">${item("inbox", "Inbox", "Inbox")}<div class="hub-sidebar-sep"></div>` +
    HUB_SECTIONS.map((s) => item(s.id, s.title, s.icon)).join("") +
    `</nav><div class="hub-sidebar-sep"></div>` +
    `<section class="hub-tags" aria-label="Tags"><div class="hub-tags-head"><span>Tags</span><span class="link-button">${icon("Edit")} Manage</span></div>${tagListSkeleton()}</section>` +
    `<div class="hub-nav-item hub-sidebar-toggle">${icon("DoubleChevronLeft", "hub-nav-icon")}</div></aside>` +
    `<main class="hub-main"><div class="hub-toolbar">` +
    `<div class="search-box">${icon("Search")}<input type="search" placeholder="Search by title, number, author, branch or tag" aria-label="Search pull requests" readonly tabindex="-1"><kbd>/</kbd></div>` +
    repoPickerSkeleton() +
    `<button aria-disabled="true" class="hub-refresh bolt-button bolt-icon-button disabled subtle icon-only bolt-focus-treatment" tabindex="-1" type="button" aria-label="Refresh">${icon("Refresh", "left-icon medium")}</button>` +
    `<span class="spacer"></span>${button("New pull request", { primary: true })}</div>${hubRowsSkeleton()}</main>` +
    `</div><script>${preferences}</script>`
  );
}

// ---------- pull request ----------

/** The PR page's tabs (ui/App.tsx TabBar), with `selected` the one the link opens; their counts come with the data. */
function tabsSkeleton(selected: string): string {
  const tab = (id: string, name: string) =>
    `<div class="bolt-tab focus-treatment flex-noshrink${id === selected ? " selected" : ""}" role="tab" aria-selected="${id === selected}">` +
    `<span class="bolt-tab-inner-container"><span class="bolt-tab-text" data-content="${name}">${name}</span></span></div>`;
  return (
    `<div class="pr-tabs bolt-tabbar flex-row flex-center flex-noshrink sticky"><div class="bolt-tabbar-tabs flex-grow flex-wrap bolt-tabs flex-row tall" role="tablist">` +
    `${tab("overview", "Overview")}${tab("files", "Files")}${tab("commits", "Commits")}</div><div class="tab-row-controls"></div></div>`
  );
}

/** The Overview's comment box (ui/CommentComposer.tsx), which looks the same loaded or not; its text box is read-only here. */
function composerSkeleton(): string {
  const tool = (title: string, glyph: string) => `<button type="button" class="md-tool" title="${title}" aria-label="${title}" tabindex="-1">${icon(glyph)}</button>`;
  const text = (title: string, glyph: string) => `<button type="button" class="md-tool" title="${title}" aria-label="${title}" tabindex="-1"><span class="md-glyph">${glyph}</span></button>`;
  const sep = `<span class="md-sep"></span>`;
  return (
    `<form class="comment-composer"><div class="md-editor"><div class="md-editor-bar">` +
    `<div class="md-tabs" role="tablist" aria-label="Add a comment mode"><button type="button" role="tab" aria-selected="true" class="selected" tabindex="-1">Write</button><button type="button" role="tab" aria-selected="false" tabindex="-1">Preview</button></div>` +
    `<div class="md-toolbar" role="toolbar" aria-label="Formatting">` +
    tool("Heading", "FontSize") + tool("Bold (Ctrl+B)", "Bold") + tool("Italic (Ctrl+I)", "Italic") + tool("Strikethrough", "Strikethrough") + sep +
    text("Quote", "❝") + tool("Code (Ctrl+E)", "Code") + tool("Link (Ctrl+K)", "Link") + sep +
    tool("Bulleted list", "BulletedList") + tool("Numbered list", "NumberedList") + tool("Checklist", "CheckList") + sep +
    text("Mention someone", "@") +
    `</div></div><div class="md-input"><textarea aria-label="Add a comment" placeholder="Add a comment. Markdown and @mentions are supported." readonly tabindex="-1" style="height:76px"></textarea></div></div>` +
    `<div class="editor-actions"><span class="muted editor-hint">Ctrl+Enter to submit</span>` +
    `<button aria-disabled="true" class="bolt-button disabled primary bolt-focus-treatment" tabindex="-1" type="button"><span class="bolt-button-text body-m">Comment</span></button></div></form>`
  );
}

/** An Overview sidebar card (ui/OverviewTab.tsx Side), with its action link disabled until the data is in. */
const side = (title: string, body: string, action?: string) =>
  `<section class="side-section"><h3>${title}${action ? ` <button class="link-button" disabled tabindex="-1">${action}</button>` : ""}</h3>${body}</section>`;
const loading = (text: string) => `<p class="muted">${text}</p>`;

/** The Overview as the page shows it while its data loads: the description's card, the timeline and comment box, the sidebar's cards. */
function overviewSkeleton(hint: PrSkeletonHint): string {
  const who = hint.author
    ? `${hint.author.imageUrl ? `<img class="avatar" src="${esc(hint.author.imageUrl)}" width="32" height="32" alt="">` : avatar(32)}<div><strong>${esc(hint.author.displayName)}</strong> opened this pull request</div>`
    : `${avatar(32)}<div>${bar("220px")}</div>`;
  return (
    `<div class="overview"><div class="overview-main">` +
    `<div class="timeline-card description"><div class="card-head">${who}</div><div class="markdown card-body">${bar("88%")}${bar("56%")}</div></div>` +
    `<ol class="timeline"><li class="muted" aria-busy="true">Loading comments and votes…</li></ol>` +
    composerSkeleton() +
    `</div><aside class="overview-side">` +
    side("Guided review", loading("Loading guided view…")) +
    side("Reviewers", `<ul class="people"><li>${avatar(24)}<div class="name">${bar("120px")}</div></li></ul>`, "Add") +
    side("Checks", loading("Loading checks…")) +
    side("Tags", loading("Loading tags…"), "Add") +
    side("Work items", loading("Loading work items…"), "Link") +
    `</aside></div>`
  );
}

/**
 * A pull request's header, tabs and the open tab while it loads; the breadcrumb is the caller's (React makes it a
 * link back). The actions are the page's own buttons, disabled, as they stay until the data is in. `tab` is the tab
 * the link opens (the page's hash); only the Overview has a skeleton, the others fill in from their own loading state.
 */
export function prSkeletonBody(hint: PrSkeletonHint, tab = "overview"): string {
  const selected = ["files", "commits"].includes(tab) ? tab : "overview";
  const title = hint.title ? esc(hint.title) : bar("55%", "skeleton-h1");
  const author = hint.author
    ? `${hint.author.imageUrl ? `<img class="avatar" src="${esc(hint.author.imageUrl)}" width="20" height="20" alt="" title="${esc(hint.author.displayName)}">` : avatar(20)}<strong>${esc(hint.author.displayName)}</strong>`
    : `${avatar(20)}${bar("96px")}`;
  const branch = (name?: string) => (name ? `<span class="branch">${esc(name)}</span>` : bar("88px"));
  return (
    `<header class="pr-header"><div class="pr-title-row"><h1>${title} <span class="pr-id">!${hint.id}</span></h1>` +
    `<div class="pr-actions"><div class="review-button">${button("Review", { icon: "ReviewSolid" })}</div>` +
    splitButton("Approve", { className: "vote-button" }) +
    splitButton("Complete", { icon: "BranchMerge", primary: true }) +
    `<div class="more-menu bolt-expandable-button inline-flex-row"><button aria-disabled="true" aria-label="More actions" class="icon-only bolt-button bolt-icon-button disabled icon-only bolt-focus-treatment" tabindex="-1" type="button">${icon("More", "left-icon medium")}</button></div>` +
    `</div></div>` +
    `<div class="pr-meta">${hint.status ? status(hint.status) : `<span class="status-pill skeleton-status"></span>`}${author}` +
    `<span class="muted">wants to merge</span>${branch(hint.sourceBranch)}<span class="muted">into</span>${branch(hint.targetBranch)}` +
    `<span class="muted">· opened ${bar("72px")}</span></div></header>` +
    tabsSkeleton(selected) +
    `<main class="tab-content tab-${selected}">${selected === "overview" ? overviewSkeleton(hint) : ""}</main>`
  );
}

/** A pull request before React, with a plain-text breadcrumb. */
export function prSkeleton(hint: PrSkeletonHint, tab?: string): string {
  const repo = hint.repo ? `<span class="crumb-sep">/</span><span class="crumb">${esc(hint.repo)}</span>` : "";
  return (
    `<div class="review-page skeleton-page" aria-busy="true" aria-label="Loading pull request">` +
    `<nav class="breadcrumb" aria-label="Breadcrumb"><span class="crumb-link">${icon("Back")} Pull requests</span>${repo}<span class="crumb-sep">/</span><span class="crumb">!${hint.id}</span>` +
    `<span class="spacer"></span><span class="crumb-link">Classic review ${icon("NavigateExternalInline")}</span></nav>` +
    prSkeletonBody(hint, tab) +
    `</div>`
  );
}

// ---------- settings ----------

const help = (lines: number) => `<p class="settings-help muted">${bar("82%")}${lines > 1 ? bar("48%") : ""}</p>`;
/** azure-devops-ui's Toggle, disabled, as a setting shows until it has loaded (its state isn't known yet). */
const toggle = (label: string) =>
  `<div class="bolt-toggle-button disabled"><div aria-disabled="true" class="bolt-toggle-button-pill flex-noshrink" role="switch" aria-checked="false"><div class="bolt-toggle-button-icon"></div></div>` +
  `<div class="bolt-toggle-button-text body-m">${esc(label)}</div></div>`;
const textField = `<div class="bolt-textfield flex-row flex-center"><input class="bolt-textfield-input flex-grow" disabled tabindex="-1" aria-hidden="true"></div>`;
const toggleField = (label: string) => `<div class="settings-field"><div class="settings-label-row">${toggle(label)}</div>${help(1)}</div>`;
/** A labeled setting with its help text in gray, then `fields`: the setting's own inputs, disabled. */
const inputField = (label: string, lines: number, fields = "") =>
  `<div class="settings-field"><div class="settings-label-row"><span class="settings-label">${esc(label)}</span></div>${lines ? help(lines) : ""}${fields}</div>`;
/** Inputs in the width their page gives them: the trunk branch rows (StackSettings) or a release setting (ChangelogSettings). */
const trunkRows = `<ul class="trunk-rows">${`<li><div class="flex-column">${textField}</div></li>`.repeat(2)}</ul>`;
const releaseInput = `<div class="release-settings-input"><div class="flex-column">${textField}</div></div>`;
const dropdown = `<div class="bolt-expandable-button inline-flex-row"><button aria-disabled="true" class="bolt-button disabled bolt-focus-treatment" tabindex="-1" type="button"><span class="bolt-button-text body-m">${bar("88px")}</span>${icon("ChevronDownMed", "icon-right font-weight-normal small")}</button></div>`;
// Its text column is as wide as its words, so the gray lines get a width of their own.
const featureMode = (label: string) =>
  `<div class="feature-mode"><div><div class="settings-label">${esc(label)}</div><p class="settings-help muted">${bar("320px")}${bar("180px")}</p></div>${dropdown}</div>`;

/**
 * The body of each settings section before its settings load: the section's own labels, with its toggles and
 * fields disabled and its help text in gray. The keys are the components that show them (ui/settings/*.tsx,
 * ui/hub/AiTitlesSetting.tsx).
 */
export const SETTINGS_BODIES = {
  /** ui/settings/ProjectFeatures.tsx */
  features: toggleField("Deck") + toggleField("Changelog"),
  /** ui/settings/StackSettings.tsx */
  stacks: inputField("Trunk branches", 2, trunkRows) + toggleField("Auto-restack"),
  /** ui/settings/ChangelogSettings.tsx */
  changelog: inputField("Tag convention", 2, releaseInput) + inputField("Per repository", 1, releaseInput),
  /** ui/hub/AiTitlesSetting.tsx */
  ai: toggleField("AI group titles"),
  /** ui/settings/FeatureAccess.tsx */
  orgFeatures: `<div class="feature-access"><div class="feature-modes">${featureMode("Deck")}${featureMode("Changelog")}</div>${inputField("Projects", 2)}</div>`,
  /** ui/settings/OrganizationSettingsPage.tsx OrganizationAiTitles */
  orgAi: toggleField("Projects can use AI group titles"),
  /** ui/settings/BackendSetting.tsx */
  orgBackend: help(2) + inputField("Backend URL", 0, textField) + inputField("API key", 1, textField),
};

const settingsPage = (subtitle: string, sections: [id: string, title: string, body: string][]) =>
  `<div class="settings-page skeleton-page" aria-busy="true" aria-label="Loading settings">` +
  `<header class="settings-header"><h1>Review Deck</h1><p class="muted">${esc(subtitle)}</p></header>` +
  sections.map(([id, title, body]) => `<section class="settings-section" aria-labelledby="settings-${id}"><h2 id="settings-${id}">${esc(title)}</h2>${body}</section>`).join("") +
  `</div>`;

/** Project settings → Review Deck before React (ui/settings/SettingsPage.tsx). */
export function settingsSkeleton(): string {
  return settingsPage("Settings for this project's pull request hub, review page and changelog.", [
    ["features", "Deck and Changelog", SETTINGS_BODIES.features],
    ["stacks", "Stacked pull requests", SETTINGS_BODIES.stacks],
    ["changelog", "Changelog", SETTINGS_BODIES.changelog],
    ["ai", "AI group titles", SETTINGS_BODIES.ai],
  ]);
}

/** Organization settings → Review Deck before React (ui/settings/OrganizationSettingsPage.tsx). */
export function orgSettingsSkeleton(): string {
  return settingsPage("Settings for every project in this organization.", [
    ["features", "Deck and Changelog", SETTINGS_BODIES.orgFeatures],
    ["ai", "AI group titles", SETTINGS_BODIES.orgAi],
    ["backend", "Backend", SETTINGS_BODIES.orgBackend],
  ]);
}

// ---------- changelog ----------

/** A tag's changelog before it loads: groups of entries in gray (ui/changelog/ChangelogPage.tsx Changelog). */
export function changelogBodySkeleton(): string {
  const group = (widths: number[]) => `<div class="changelog-section"><h3>${bar("110px", "skeleton-h3")}</h3><ul>${widths.map((w) => `<li>${bar(`${w}%`)}</li>`).join("")}</ul></div>`;
  return `<section class="changelog" aria-busy="true" aria-label="Loading changelog">${group([58, 44])}${group([62, 50, 38])}${group([46])}</section>`;
}

/** The selected tag's card before it loads (ui/changelog/ChangelogPage.tsx TagView). */
export function tagCardSkeleton(): string {
  return (
    `<article class="tag-card" aria-busy="true" aria-label="Loading the tag"><header class="tag-card-head"><h2 class="tag-name">${bar("88px", "skeleton-h1")}</h2>` +
    `<span class="spacer"></span><span class="tag-meta muted">${bar("180px")}</span></header>` +
    `<div class="tag-card-body"><section class="tag-description">${bar("64%")}${bar("40%")}</section>${changelogBodySkeleton()}</div></article>`
  );
}

/** The tag list and the selected tag before they load (ui/changelog/ChangelogPage.tsx TagList); `list` is its title. */
export function tagExplorerSkeleton(list = "Release list"): string {
  const items = [52, 64, 48, 56, 44, 60, 50, 46].map((w) => `<li><span class="tag-list-item">${bar(`${w}%`)}</span></li>`).join("");
  return (
    `<div class="tag-explorer"><nav class="tag-list" aria-labelledby="tag-list-title" aria-busy="true"><h2 id="tag-list-title">${esc(list)}</h2><ol>${items}</ol></nav>` +
    `<main class="tag-explorer-main">${tagCardSkeleton()}</main></div>`
  );
}

/**
 * Repos → Changelog before React: the Releases | Tags switch, the search box and the tag explorer. The script after
 * it switches to Tags when that's the view this browser kept (ui/changelog/ChangelogPage.tsx "changelog.view").
 */
export function changelogSkeleton(): string {
  const view = (id: string, text: string, glyph: string, selected: boolean) =>
    `<button type="button" role="tab" aria-selected="${selected}" class="${selected ? "selected" : ""}" data-view="${id}" tabindex="-1">${icon(glyph)}${text}</button>`;
  const tags =
    `(function(){try{if(localStorage.getItem(${JSON.stringify(preferenceKey("changelog.view"))})!=="tags")return;var p=document.querySelector(".changelog-page.skeleton-page");` +
    `p.querySelectorAll(".changelog-views button").forEach(function(b){var on=b.getAttribute("data-view")==="tags";b.classList.toggle("selected",on);b.setAttribute("aria-selected",String(on))});` +
    `p.querySelector(".changelog-search input").placeholder="Find a tag";p.querySelector("#tag-list-title").textContent="Tag list"}catch(e){}})();`;
  return (
    `<div class="changelog-page skeleton-page" aria-busy="true" aria-label="Loading the changelog"><header class="changelog-header">` +
    `<div class="changelog-views" role="tablist" aria-label="Show">${view("releases", "Releases", "Package", true)}${view("tags", "Tags", "Tag", false)}</div>` +
    `<span class="spacer"></span><div class="search-box changelog-search">${icon("Search")}<input type="search" placeholder="Find a release" aria-label="Find a release" readonly tabindex="-1"></div>` +
    `</header>${tagExplorerSkeleton()}</div><script>${tags}</script>`
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
