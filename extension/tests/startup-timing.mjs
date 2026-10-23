// Startup timing and skeleton checks for the built extension, in a Chromium that plays the Azure DevOps host.
//
//   npm run ext:build
//   node extension/tests/startup-timing.mjs                       # extension/ as built
//   node extension/tests/startup-timing.mjs --root .cache/baseline --runs 5 --latency 40
//   node extension/tests/startup-timing.mjs --only "local hub" --runs 10
//   node extension/tests/startup-timing.mjs --shots .cache/shots   # screenshots of the skeletons and pages
//
// The host page is a fake: it answers the SDK handshake (with a dark theme), the navigation service (route from
// the scenario), the location service (REST calls go to a second server, over HTTP/2 and cross-origin with CORS
// preflights as dev.azure.com's are, which returns one pull request, PULL_REQUEST, and an empty list for everything
// else, as the client asks for them with noArrayWrap; over HTTP/1.1 on this server without openssl), extension
// data (nothing stored, answered after ?data= ms) and the access token. Every other service fails, as a locked-down
// host would. Times are milliseconds from the moment the iframe starts loading, medians over the runs, for a cold
// browser profile and a warm one (second visit).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createSecureServer } from "node:http2";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright-core";

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) args.set(a.slice(2), process.argv[i + 1] === undefined || process.argv[i + 1].startsWith("--") ? "true" : process.argv[++i]);
}
const root = resolve(args.get("root") ?? "extension");
const runs = Number(args.get("runs") ?? 5);
const latency = Number(args.get("latency") ?? 30);
const shots = args.get("shots");
const only = args.get("only");
const chrome = args.get("chrome") ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(existsSync);

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".woff": "font/woff", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml", ".map": "application/json" };
const DARK = {
  "background-color": "rgba(32, 31, 30, 1)", "text-primary-color": "rgba(255, 255, 255, .87)", "text-secondary-color": "rgba(255, 255, 255, .55)",
  "communication-background": "rgba(0, 120, 212, 1)", "communication-foreground": "rgba(71, 158, 245, 1)", "palette-neutral-2": "40, 39, 38",
  "palette-neutral-4": "44, 43, 42", "palette-neutral-8": "53, 52, 51", "palette-black-alpha-6": "rgba(255, 255, 255, 0.06)", "palette-black-alpha-10": "rgba(255, 255, 255, 0.10)",
};

/**
 * The fake host page. `query` is what the navigation service reports; `handshake` delays its answer, and `data`
 * every extension data call (organization settings, synced preferences), which finds nothing.
 */
function hostHtml(query, handshake, data, apiRoot) {
  return `<!doctype html><html><body style="margin:0"><script>
    const query = ${JSON.stringify(query)};
    const marks = (window.marks = { start: Date.now() });
    const proxies = { 1: () => query, 2: () => {}, 3: () => {}, 4: () => {}, 5: () => ${JSON.stringify(apiRoot)}, 6: () => location.hash.slice(1), 7: () => {},
      8: () => ({ getDocument: { __proxyFunctionId: 9 }, getDocuments: { __proxyFunctionId: 9 }, getValue: { __proxyFunctionId: 9 } }) };
    // Extension data: answered after a delay, as a REST call to Azure DevOps would be, with "not found".
    const slow = { 9: { message: "Document not found", status: 404 } };
    window.addEventListener("message", (event) => {
      let m; try { m = JSON.parse(event.data); } catch { return; }
      if (!m.instanceId && !m.methodName) return;
      const reply = (result, error) => event.source.postMessage(JSON.stringify({ id: m.id, result, error, handshakeToken: m.handshakeToken }), "*");
      const name = m.methodName;
      if (name === "initialHandshake") {
        marks.handshake = Date.now();
        setTimeout(() => reply({
          context: { pageContext: { webContext: { project: { id: "p1", name: "Storefront" } } }, extension: { publisherId: "test", extensionId: "review", version: "0.0.0" },
            user: { id: "u1", displayName: "Jordan Rivera", name: "jordan" }, host: { id: "h1", name: "contoso" } },
          initialConfig: {}, contributionId: "test.review.review-hub", themeData: ${JSON.stringify(DARK)},
        }), ${handshake});
      } else if (name === "getService") {
        const id = m.params?.[0];
        if (id === "ms.vss-features.host-navigation-service") reply({ getQueryParams: { __proxyFunctionId: 1 }, setQueryParams: { __proxyFunctionId: 2 }, setDocumentTitle: { __proxyFunctionId: 3 }, navigate: { __proxyFunctionId: 4 },
          getHash: { __proxyFunctionId: 6 }, setHash: { __proxyFunctionId: 7 }, replaceHash: { __proxyFunctionId: 7 }, onHashChanged: { __proxyFunctionId: 7 } });
        else if (id === "ms.vss-features.extension-data-service") reply({ getExtensionDataManager: { __proxyFunctionId: 8 } });
        else if (id === "ms.vss-features.location-service") reply({ getResourceAreaLocation: { __proxyFunctionId: 5 }, getServiceLocation: { __proxyFunctionId: 5 } });
        else reply(undefined, { message: "Service " + id + " is not in the harness" });
      } else if (name === "getAccessToken" || name === "getAppToken") reply({ token: "harness" });
      else if (name === "notifyLoadSucceeded") { marks.loaded = Date.now(); reply(); }
      else if (name === "notifyLoadFailed") { marks.failed = Date.now(); reply(); }
      else if (slow[name?.slice(5)]) setTimeout(() => reply(undefined, slow[name.slice(5)]), ${data});
      else if (name?.startsWith("proxy")) reply(proxies[name.slice(5)]?.() ?? null);
      else reply(null);
    });
    const frame = document.createElement("iframe");
    frame.style.cssText = "width:100vw;height:100vh;border:0;display:block";
    frame.src = "/dist/review.html";
    document.body.appendChild(frame);
  </script></body></html>`;
}

/** Inside every frame: when each landmark first appears, as epoch milliseconds. */
const FRAME_MARKS = `(() => {
  const marks = (window.frameMarks = {});
  const wanted = {
    skeleton: ".skeleton-page, .inbox-section.skeleton, .page-loading",
    hubReact: ".hub-toolbar input[type=search]",
    hubRows: ".pr-row",
    prSkeleton: ".review-page",
    // The PR's page with its data: from the copy kept in this browser (data/prCache.ts) or loaded.
    prReact: ".pr-actions button",
    // Loaded: its buttons work (they wait while the kept copy shows).
    prLive: ".vote-button button:not([disabled]):not(.disabled):not([aria-disabled=true])",
    settled: ".inbox-section:not(.skeleton), .error-box, .pr-actions button",
  };
  const check = () => {
    for (const [name, selector] of Object.entries(wanted)) if (!(name in marks) && document.querySelector(selector)) marks[name] = Date.now();
  };
  // Attributes too: a button that becomes enabled is a landmark (prLive).
  new MutationObserver(check).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "disabled", "aria-disabled"] });
  document.addEventListener("DOMContentLoaded", () => { marks.dom = Date.now(); check(); });
  check();
})();`;

/**
 * One origin for everything but the REST API, so the browser's storage (theme, hub cache) carries between pages.
 * /host?pr=&repo= is the fake host; ?handshake=<ms> delays its handshake and ?api=<ms> every later REST answer.
 */
async function serve() {
  let apiDelay = 0;
  // HTTP/1.1 would queue the page's REST calls six at a time, which dev.azure.com's HTTP/2 doesn't.
  const tls = certificate();
  const api = tls && createSecureServer({ ...tls, allowHTTP1: true }, (req, res) => answerApi(req, res, req.method === "OPTIONS" ? latency : apiDelay));
  const apiOrigin = api && (await new Promise((ok) => api.listen(0, "127.0.0.1", () => ok(`https://127.0.0.1:${api.address().port}`))));
  if (!api) console.warn("No openssl: the REST stub runs over HTTP/1.1, which queues requests six at a time.");
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/host") apiDelay = Number(url.searchParams.get("api") ?? 0);
    if (url.pathname.startsWith("/api/")) return answerApi(req, res, apiDelay);
    setTimeout(() => {
      if (url.pathname === "/host") {
        const query = url.searchParams.get("pr") ? { pr: url.searchParams.get("pr"), repo: url.searchParams.get("repo") } : {};
        const apiRoot = apiOrigin ? `${apiOrigin}/api/` : `http://${req.headers.host}/api/`;
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(hostHtml(query, Number(url.searchParams.get("handshake") ?? 0), Number(url.searchParams.get("data") ?? 0), apiRoot));
      }
      const file = normalize(join(root, decodeURIComponent(url.pathname)));
      if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
        res.writeHead(404);
        return res.end("not found");
      }
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "public, max-age=3600" });
      res.end(readFileSync(file));
    }, latency);
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => (server.close(), api?.close()) };
}

/** The REST stub, after `wait` ms; answers CORS preflights as dev.azure.com does (cached for an hour). */
function answerApi(req, res, wait) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "OPTIONS,GET,POST,PATCH,PUT,DELETE",
    "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "authorization",
    "access-control-max-age": "3600",
  };
  setTimeout(() => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      return res.end();
    }
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify(/\/pullRequests\/\d+$/.test(new URL(req.url, "http://x").pathname) ? PULL_REQUEST : []));
  }, wait);
}

/** A throwaway self-signed certificate (browsers speak HTTP/2 only over TLS), or null without openssl. */
function certificate() {
  const dir = mkdtempSync(join(tmpdir(), "startup-timing-"));
  const [key, cert] = [join(dir, "key.pem"), join(dir, "cert.pem")];
  // On PATH, or Git for Windows' copy (not on PATH outside Git Bash).
  for (const openssl of ["openssl", "C:/Program Files/Git/usr/bin/openssl.exe"]) {
    try {
      execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=127.0.0.1"], {
        stdio: "ignore",
        env: { ...process.env, MSYS_NO_PATHCONV: "1" },
      });
      return { key: readFileSync(key), cert: readFileSync(cert) };
    } catch {
      // Try the next.
    }
  }
  return null;
}

/** The one pull request the stub API knows, as GET pullRequests/{id} returns it. */
const PULL_REQUEST = {
  pullRequestId: 471,
  title: "Retry failed uploads",
  description: "Retries uploads that fail with a 5xx.",
  status: 1,
  isDraft: false,
  createdBy: { id: "u2", displayName: "Ana Lima", uniqueName: "ana@contoso.com" },
  creationDate: "2026-10-01T00:00:00Z",
  sourceRefName: "refs/heads/retry-uploads",
  targetRefName: "refs/heads/main",
  repository: { id: "users-sdk", name: "users-sdk", project: { id: "p1", name: "Storefront" } },
  reviewers: [],
  mergeStatus: 3,
};

const SCENARIOS = [
  { name: "hosted hub", path: "/host", frame: ["dom", "skeleton", "hubReact", "settled"], host: ["handshake", "loaded"] },
  // Organization settings take a REST round trip in Azure DevOps; a warm visit's cached rows shouldn't wait for it.
  { name: "hosted hub, slow extension data", path: "/host?data=400", frame: ["dom", "skeleton", "hubReact", "settled"], host: ["handshake", "loaded"] },
  { name: "hosted PR", path: "/host?pr=471&repo=users-sdk", frame: ["dom", "skeleton", "prSkeleton", "prReact", "prLive"], host: ["handshake", "loaded"] },
  // Each Azure DevOps REST call takes 250–500 ms (measured on a small organization), so the PR's data is most of the wait.
  { name: "hosted PR, slow REST", path: "/host?pr=471&repo=users-sdk&api=400", frame: ["dom", "skeleton", "prSkeleton", "prReact", "prLive"], host: ["handshake", "loaded"] },
  { name: "local hub", path: "/dist/review.html?local=1", frame: ["dom", "skeleton", "hubReact", "hubRows"], host: [] },
  { name: "local PR", path: "/dist/review.html?local=1&pr=471&repo=users-sdk", frame: ["dom", "skeleton", "prSkeleton", "prReact"], host: [] },
];

/** Opens a page, tracks its requests (for timeouts), and returns the Playwright frame the extension runs in. */
async function open(context, origin, path, hosted) {
  const page = await context.newPage();
  await page.addInitScript(FRAME_MARKS);
  const pending = new Map();
  const problems = [];
  page.on("request", (r) => pending.set(r.url(), Date.now()));
  page.on("requestfinished", (r) => pending.delete(r.url()));
  page.on("requestfailed", (r) => pending.delete(r.url()));
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  const started = Date.now();
  await page.goto(origin + path, { waitUntil: "domcontentloaded" });
  const frame = hosted ? await (await page.waitForSelector("iframe", { state: "attached" })).contentFrame() : page.mainFrame();
  const waitFor = async (mark, timeout = 20_000) => {
    try {
      await frame.waitForFunction((m) => m in (window.frameMarks ?? {}), mark, { timeout });
    } catch {
      const state = await frame.evaluate(() => ({ marks: window.frameMarks, text: document.body.innerText.slice(0, 400) })).catch(() => ({}));
      throw new Error(
        `${path}: "${mark}" never appeared.\n  marks: ${JSON.stringify(state.marks)}\n  page text: ${JSON.stringify(state.text)}\n  pending requests: ${[...pending.keys()].join(", ") || "none"}\n  errors: ${problems.join("\n          ") || "none"}`,
      );
    }
  };
  return { page, frame, started, waitFor };
}

async function measure(context, origin, scenario) {
  const { page, frame, started, waitFor } = await open(context, origin, scenario.path, scenario.host.length > 0);
  await waitFor(scenario.frame.at(-1));
  const frameMarks = await frame.evaluate(() => window.frameMarks ?? {});
  const hostMarks = scenario.host.length ? await page.evaluate(() => window.marks) : { start: started };
  const start = hostMarks.start ?? started;
  const result = {};
  for (const m of scenario.host) if (hostMarks[m]) result[m] = hostMarks[m] - start;
  for (const m of scenario.frame) if (frameMarks[m]) result[m] = frameMarks[m] - start;
  await page.close();
  return result;
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : undefined;
};

async function main() {
  if (!chrome) throw new Error("No Chrome found; pass --chrome <path to chrome.exe>");
  const { origin, close } = await serve();
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    if (shots) {
      await screenshots(browser, origin, shots);
      return;
    }
    console.log(`root ${root}\n${runs} runs per scenario, ${latency} ms added to every response (REST: 0 ms unless the scenario says). Medians, ms from navigation start.\n`);
    for (const scenario of SCENARIOS) {
      if (only && !scenario.name.includes(only)) continue;
      const cold = [];
      const warm = [];
      for (let i = 0; i < runs; i++) {
        const context = await browser.newContext({ ignoreHTTPSErrors: true });
        cold.push(await measure(context, origin, scenario));
        warm.push(await measure(context, origin, scenario));
        await context.close();
      }
      const keys = [...scenario.host, ...scenario.frame];
      const row = (label, samples) => `  ${label.padEnd(5)} ${keys.map((k) => `${k} ${String(median(samples.map((s) => s[k]).filter((v) => v !== undefined)) ?? "-").padStart(5)}`).join("  ")}`;
      console.log(scenario.name + "\n" + row("cold", cold) + "\n" + row("warm", warm));
    }
  } finally {
    await browser.close();
    close();
  }
}

/** Pictures of the skeletons (a slow handshake and REST API hold them on screen) and of the loaded pages. */
async function screenshots(browser, origin, dir) {
  mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  // A first visit, so the theme is kept: the skeletons below paint in it before the handshake.
  const first = await open(context, origin, "/host", true);
  await first.waitFor("settled");
  await first.page.close();

  const hub = await open(context, origin, "/host?handshake=4000", true);
  await hub.page.waitForTimeout(800);
  await hub.page.screenshot({ path: join(dir, "1-hub-skeleton-before-handshake.png") });
  await hub.page.close();

  const pr = await open(context, origin, "/host?pr=471&repo=users-sdk&handshake=500&api=8000", true);
  await pr.waitFor("prSkeleton");
  await pr.page.waitForTimeout(1500);
  await pr.page.screenshot({ path: join(dir, "2-pr-skeleton-after-handshake.png") });
  await pr.page.close();

  const local = await open(context, origin, "/dist/review.html?local=1&theme=dark", false);
  await local.waitFor("hubRows");
  await local.page.waitForTimeout(500);
  await local.page.screenshot({ path: join(dir, "3-local-hub-loaded.png") });
  // Hold the PR's data back, to see its skeleton filled in from the hub's cache.
  await local.page.route("**/dev-data/demo-*.json", async (route) => {
    await new Promise((ok) => setTimeout(ok, 3000));
    await route.continue();
  });
  await local.page.locator(".pr-row").first().click();
  await local.page.waitForTimeout(600);
  await local.page.screenshot({ path: join(dir, "4-local-pr-opening.png") });
  await local.waitFor("prReact");
  await local.page.waitForTimeout(500);
  await local.page.screenshot({ path: join(dir, "5-local-pr-loaded.png") });
  await context.close();
  console.log(`Screenshots in ${dir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
