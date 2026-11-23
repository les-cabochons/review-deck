import assert from "node:assert/strict";
import { test } from "node:test";
import { SECTION_META, SECTION_ORDER } from "../src/data/list";
import { changelogSkeleton, HUB_SECTIONS, hubRowsSkeleton, hubSkeleton, orgSettingsSkeleton, prSkeleton, prSkeletonBody, settingsSkeleton, THEME_KEY, themeBootScript } from "../src/skeletons";

test("Given the hub skeleton, then it has the hub's layout: sidebar sections, toolbar and placeholder rows", () => {
  const html = hubSkeleton();
  for (const text of ["Inbox", "Needs your review", "Other active", "Tags"]) assert.ok(html.includes(`>${text}<`), text);
  assert.ok(html.includes('class="hub-sidebar"') && html.includes('class="hub-toolbar"') && html.includes('class="search-box"'));
  assert.equal(html.split('class="pr-row skeleton"').length - 1, 6);
  assert.ok(html.includes(hubRowsSkeleton()));
  assert.ok(hubRowsSkeleton("Loading <all> projects…").includes("Loading &lt;all&gt; projects…"));
});

// The skeleton can't import data/list.ts (it is evaluated by the build with no imports), so it keeps a copy.
test("Given the hub's sections, then the skeleton's sidebar lists the same ones, in order, with the same icons", () => {
  assert.deepEqual(
    HUB_SECTIONS,
    SECTION_ORDER.map((id) => ({ id, title: SECTION_META[id].title, icon: SECTION_META[id].icon })),
  );
});

test("Given facts from the hub, then the PR skeleton shows them escaped; without them it shows bars", () => {
  const html = prSkeleton({
    id: 42,
    title: 'Use <b>bold</b> & "quotes"',
    repo: "web",
    author: { displayName: "Ana <Lopez>", imageUrl: "https://x/a.png?x=1&y=2" },
    sourceBranch: "feat/x",
    targetBranch: "main",
    status: "draft",
  });
  assert.ok(html.includes('<h1>Use &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quotes&quot; <span class="pr-id">!42</span></h1>'));
  assert.ok(!html.includes("<b>"));
  assert.ok(html.includes("<strong>Ana &lt;Lopez&gt;</strong>"));
  assert.ok(html.includes('src="https://x/a.png?x=1&amp;y=2"'));
  assert.ok(/class="status-pill status-draft">.*ms-Icon--BranchRequestDraft.*> Draft</.test(html));
  assert.ok(html.includes('class="branch">feat/x<') && html.includes('class="branch">main<'));
  assert.ok(html.includes('class="crumb">web<') && html.includes('class="crumb">!42<'));

  const bare = prSkeletonBody({ id: 7 });
  assert.ok(bare.includes("skeleton-h1") && bare.includes(">!7<"));
  assert.ok(bare.includes("skeleton-status") && !bare.includes("status-pill status-") && !bare.includes("<strong>") && !bare.includes("<img"));
  assert.ok(bare.includes(">Overview<") && bare.includes(">Files<") && bare.includes(">Commits<"));
});

test("Given the settings and changelog skeletons, then each has its page's sections", () => {
  const project = settingsSkeleton();
  for (const title of ["Deck and Changelog", "Stacked pull requests", "Changelog", "AI group titles"]) assert.ok(project.includes(`>${title}</h2>`), title);
  const organization = orgSettingsSkeleton();
  for (const title of ["Deck and Changelog", "AI group titles", "Backend"]) assert.ok(organization.includes(`>${title}</h2>`), title);
  const changelog = changelogSkeleton();
  assert.ok(changelog.includes(">Releases</button>") && changelog.includes(">Tags</button>") && changelog.includes(">Release list</h2>"));
});

test("Given a kept theme, then the boot script applies it as CSS variables, and nothing without one", () => {
  const theme = {
    "background-color": "rgba(32, 31, 30, 1)",
    "text-primary-color": "rgba(255, 255, 255, .87)",
    "bad key;": "dropped",
    "palette-neutral-2": "40, 39, 38; } body { color: red",
  };
  const run = (stored: string | null) => {
    const head: { textContent?: string }[] = [];
    const localStorage = { getItem: (key: string) => (key === THEME_KEY ? stored : null) };
    const document = { createElement: () => ({ textContent: "" }), head: { appendChild: (el: { textContent?: string }) => head.push(el) } };
    new Function("localStorage", "document", themeBootScript())(localStorage, document);
    return head;
  };
  assert.equal(
    run(JSON.stringify(theme))[0]?.textContent,
    ":root{--background-color:rgba(32, 31, 30, 1);--text-primary-color:rgba(255, 255, 255, .87);--palette-neutral-2:40, 39, 38  body  color: red}body{color:var(--text-primary-color)}",
  );
  assert.equal(run(null).length, 0);
  assert.equal(run("not json").length, 0);
});
