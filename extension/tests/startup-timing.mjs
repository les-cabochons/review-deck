// Startup timing and skeleton checks for the built extension, in a Chromium that plays the Azure DevOps host.
//
//   npm run ext:build
//   node extension/tests/startup-timing.mjs                       # extension/ as built
//   node extension/tests/startup-timing.mjs --root .cache/baseline --runs 5 --latency 40
//   node extension/tests/startup-timing.mjs --only "local hub" --runs 10
//   node extension/tests/startup-timing.mjs --shots .cache/shots   # screenshots of the skeletons and pages
//   node extension/tests/startup-timing.mjs --check                # a PR that loads only in part isn't kept in the browser
//   node extension/tests/startup-timing.mjs --calls --runs 3       # REST calls per step of hub → PR → hub, not timings
//
// The host page is a fake: it answers the SDK handshake (with a dark theme), the navigation service (route from
// the scenario), the location service (REST calls go to a second server, over HTTP/2 and cross-origin with CORS
// preflights as dev.azure.com's are, which lists the hub's pull requests, PULL_REQUESTS, returns one of them by id,
// with one update that changes two files, FILES, whose contents come as a zip, and an empty list for everything
// else, as the client asks for them with noArrayWrap; over HTTP/1.1 on this server without openssl), extension data
// (nothing stored, answered after ?data= ms) and the access token. Every other service fails, as a locked-down host
// would. Times are milliseconds from the moment the iframe starts loading, medians over the runs, for a cold browser
// profile and a warm one (second visit).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createSecureServer } from "node:http2";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
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
const check = args.has("check");
const only = args.get("only");
const calls = args.has("calls");
const chrome = args.get("chrome") ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(existsSync);

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".woff": "font/woff", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml", ".map": "application/json" };
const DARK = {
  "background-color": "rgba(32, 31, 30, 1)", "text-primary-color": "rgba(255, 255, 255, .87)", "text-secondary-color": "rgba(255, 255, 255, .55)",
  "communication-background": "rgba(0, 120, 212, 1)", "communication-foreground": "rgba(71, 158, 245, 1)", "palette-neutral-2": "40, 39, 38",
  "palette-neutral-4": "44, 43, 42", "palette-neutral-8": "53, 52, 51", "palette-black-alpha-6": "rgba(255, 255, 255, 0.06)", "palette-black-alpha-10": "rgba(255, 255, 255, 0.10)",
};

/**
 * The fake host page. `query` is what the navigation service reports; `handshake` delays its answer, and `data`
 * every extension data call (organization settings, synced preferences), which finds nothing. `tab` opens the PR's
 * page on that tab (its hash, as the page keeps the tab there).
 */
function hostHtml(query, handshake, data, apiRoot, tab) {
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
    frame.src = ${JSON.stringify(`/dist/review.html${tab ? `#${tab}` : ""}`)};
    document.body.appendChild(frame);
  </script></body></html>`;
}

/** What the page shows at each landmark. */
const LANDMARKS = {
  skeleton: ".skeleton-page, .inbox-section.skeleton, .page-loading",
  hubReact: ".hub-toolbar input[type=search]",
  hubRows: ".pr-row",
  prSkeleton: ".review-page",
  // The PR's page with its data, from the copy kept in this browser (data/prCache.ts), the PR and its updates
  // ahead of the rest (data/adoOverview.ts), or the whole load.
  prReact: ".pr-actions button",
  // Loaded, so its buttons work (they wait while the kept copy or the partial shows).
  prLive: ".vote-button button:not([disabled]):not(.disabled):not([aria-disabled=true])",
  // The Files tab shows the diff, so the update's changes and both sides of every file are in (review/engine.ts).
  prDiff: ".file-header",
  settled: ".inbox-section:not(.skeleton), .error-box, .pr-actions button",
};

/** Inside every frame: when each landmark first appears, as epoch milliseconds. */
const FRAME_MARKS = `(() => {
  const marks = (window.frameMarks = {});
  const wanted = ${JSON.stringify(LANDMARKS)};
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
 * /host?pr=&repo= is the fake host (&tab=files opens the PR on its Files tab). ?handshake=<ms> delays its handshake
 * and ?api=<ms> every later REST answer, ?jitter=<ms> adds up to that much to each at random (Azure DevOps' answers
 * are uneven), ?heavy=<ms> is the delay of the threads and commits calls instead (the big answers of a long
 * discussion), and ?fail=threads answers the threads call with a 500.
 */
async function serve() {
  // HTTP/1.1 would queue the page's REST calls six at a time, which dev.azure.com's HTTP/2 doesn't.
  const tls = certificate();
  const api = tls && createSecureServer({ ...tls, allowHTTP1: true }, (req, res) => answerApi(req, res));
  const apiOrigin = api && (await new Promise((ok) => api.listen(0, "127.0.0.1", () => ok(`https://127.0.0.1:${api.address().port}`))));
  if (!api) console.warn("No openssl: the REST stub runs over HTTP/1.1, which queues requests six at a time.");
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/host") {
      const number = (name) => Number(url.searchParams.get(name) ?? 0);
      apiTiming = { delay: number("api"), jitter: number("jitter"), heavy: number("heavy"), fail: url.searchParams.get("fail") };
    }
    if (url.pathname.startsWith("/api/")) return answerApi(req, res);
    setTimeout(() => {
      if (url.pathname === "/host") {
        const query = url.searchParams.get("pr") ? { pr: url.searchParams.get("pr"), repo: url.searchParams.get("repo") } : {};
        const apiRoot = apiOrigin ? `${apiOrigin}/api/` : `http://${req.headers.host}/api/`;
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(hostHtml(query, Number(url.searchParams.get("handshake") ?? 0), Number(url.searchParams.get("data") ?? 0), apiRoot, url.searchParams.get("tab")));
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

/** The REST stub's timing and failing call, from the last /host visit (see serve). */
let apiTiming = { delay: 0, jitter: 0, heavy: 0, fail: null };

/** How long the stub takes to answer a REST call. `heavy` for the threads and commits when set, else `delay`, plus up to `jitter` at random. */
function apiWait(pathname) {
  const base = apiTiming.heavy && /\/(threads|commits)$/.test(pathname) ? apiTiming.heavy : apiTiming.delay;
  return base + Math.random() * apiTiming.jitter;
}

/** Every REST call the stub answered (preflights left out), for `--calls`. */
const apiLog = [];

/** The REST stub; answers CORS preflights as dev.azure.com does (cached for an hour), after the fixed latency. */
function answerApi(req, res) {
  const url = new URL(req.url, "http://x");
  const pathname = url.pathname;
  if (req.method !== "OPTIONS") apiLog.push({ at: Date.now(), path: pathname });
  const wait = req.method === "OPTIONS" ? latency : apiWait(pathname);
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
    if (apiTiming.fail && pathname.endsWith(`/${apiTiming.fail}`)) {
      res.writeHead(500, { ...cors, "content-type": "application/json" });
      return res.end(JSON.stringify({ message: "Failed by the harness" }));
    }
    const { type, body } = restAnswer(req.method, url);
    res.writeHead(200, { ...cors, "content-type": type });
    res.end(body);
  }, wait);
}

/**
 * What the stub returns for a REST call: a pull request by id, the hub's rows for a list of active pull requests,
 * a pull request's one update, that update's changes, the blobs, or an empty list.
 */
function restAnswer(method, url) {
  const { pathname } = url;
  const json = (value) => ({ type: "application/json", body: JSON.stringify(value) });
  const one = /\/pullRequests\/(\d+)$/.exec(pathname);
  if (one) return json(PULL_REQUESTS.find((p) => p.pullRequestId === Number(one[1])) ?? PULL_REQUEST);
  if (/\/pullrequests$/i.test(pathname) && url.searchParams.get("searchCriteria.status") === "1") return json(PULL_REQUESTS);
  if (/\/pullRequests\/\d+\/iterations$/.test(pathname)) return json([ITERATION]);
  if (/\/pullRequests\/\d+\/iterations\/\d+\/changes$/.test(pathname)) return json({ changeEntries: FILES.map((f) => f.change) });
  // POST .../blobs is the zip of the blobs named in the body (data/blobs.ts getBlobsZip), GET .../blobs/{id} one blob's bytes.
  if (method === "POST" && /\/blobs\/?$/i.test(pathname)) return { type: "application/zip", body: BLOBS_ZIP };
  const blob = /\/blobs\/([^/]+)$/i.exec(pathname);
  if (blob) return { type: "application/octet-stream", body: BLOB_TEXT[blob[1]] ?? "" };
  return json([]);
}

/** A throwaway self-signed certificate (browsers speak HTTP/2 only over TLS), or null without openssl. */
function certificate() {
  const dir = mkdtempSync(join(tmpdir(), "startup-timing-"));
  const [key, cert] = [join(dir, "key.pem"), join(dir, "cert.pem")];
  try {
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
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const JORDAN = { id: "u1", displayName: "Jordan Rivera", uniqueName: "jordan" };
const ANA = { id: "u2", displayName: "Ana Lima", uniqueName: "ana@contoso.com" };

/** The pull request the hosted PR scenarios open, as GET pullRequests/{id} returns it; Jordan (the user) is asked to review it. */
const PULL_REQUEST = {
  pullRequestId: 471,
  title: "Retry failed uploads",
  description: "Retries uploads that fail with a 5xx.",
  status: 1,
  isDraft: false,
  createdBy: ANA,
  creationDate: "2026-10-20T00:00:00Z",
  sourceRefName: "refs/heads/retry-uploads",
  targetRefName: "refs/heads/main",
  repository: { id: "users-sdk", name: "users-sdk", project: { id: "p1", name: "Storefront" } },
  reviewers: [{ ...JORDAN, vote: 0, isRequired: false }],
  mergeStatus: 3,
};

/**
 * The hub's rows, 20 active pull requests in the project, all in sections open by default (16 ask Jordan to
 * review them, 4 are Jordan's own, waiting). Among them are PULL_REQUEST and one stacked on it (472), so its page
 * shows a stack and fetches its layers' details. The rows a round opens (471, 454) and 472 are the newest, so
 * they sit at the top of "Needs your review".
 */
const PULL_REQUESTS = [
  ...Array.from({ length: 18 }, (_, i) => {
    const id = 453 + i;
    const own = i % 5 === 0;
    return {
      ...PULL_REQUEST,
      pullRequestId: id,
      title: `Change ${id}`,
      description: "",
      createdBy: own ? JORDAN : ANA,
      creationDate: id === 454 ? "2026-10-19T00:00:00Z" : "2026-10-01T00:00:00Z",
      sourceRefName: `refs/heads/change-${id}`,
      reviewers: own ? [] : PULL_REQUEST.reviewers,
    };
  }),
  PULL_REQUEST,
  { ...PULL_REQUEST, pullRequestId: 472, title: "Retry failed uploads: tests", creationDate: "2026-10-21T00:00:00Z", sourceRefName: "refs/heads/retry-uploads-tests", targetRefName: PULL_REQUEST.sourceRefName },
];

/** The pull request's one update, as GET pullRequests/{id}/iterations returns it (with its commits). */
const ITERATION = {
  id: 1,
  createdDate: "2026-10-01T00:00:00Z",
  author: PULL_REQUEST.createdBy,
  sourceRefCommit: { commitId: "abc" },
  commonRefCommit: { commitId: "base" },
  commits: [{ commitId: "abc" }],
};

/** The update's two changed files (one edited, one added), as GET .../iterations/1/changes lists them, with both sides' text. */
const FILES = [
  {
    change: { changeTrackingId: 1, changeType: 2, item: { path: "/src/upload.ts", objectId: "b2", originalObjectId: "b1" } },
    before: ["export async function upload(file: Blob): Promise<void> {", "  const response = await fetch(\"/upload\", { method: \"POST\", body: file });", "  if (!response.ok) throw new Error(`Upload failed: ${response.status}`);", "}", ""].join("\n"),
    after: ["import { retry } from \"./retry\";", "", "export async function upload(file: Blob): Promise<void> {", "  await retry(async () => {", "    const response = await fetch(\"/upload\", { method: \"POST\", body: file });", "    if (response.status >= 500) throw new Error(`Upload failed: ${response.status}`);", "  });", "}", ""].join("\n"),
  },
  {
    change: { changeTrackingId: 2, changeType: 1, item: { path: "/src/retry.ts", objectId: "c2" } },
    after: ["/** Runs `fn` again after a failure, up to three times. */", "export async function retry(fn: () => Promise<void>, times = 3): Promise<void> {", "  for (let attempt = 1; ; attempt++) {", "    try {", "      return await fn();", "    } catch (e) {", "      if (attempt >= times) throw e;", "    }", "  }", "}", ""].join("\n"),
  },
];

/** Each blob's text by id, and the zip the blobs call returns (every blob the update touches, named by id). */
const BLOB_TEXT = Object.fromEntries(FILES.flatMap((f) => [[f.change.item.originalObjectId, f.before], [f.change.item.objectId, f.after]]).filter(([id]) => id));
const BLOBS_ZIP = zip(Object.entries(BLOB_TEXT).map(([name, text]) => ({ name, text })));

/** A zip as Azure DevOps' blobs endpoint writes one: each entry named by its blob id, deflated. */
function zip(entries) {
  const parts = [];
  const directory = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const raw = Buffer.from(e.text);
    const data = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
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
  return Buffer.concat([...parts, dir, end]);
}

const SCENARIOS = [
  { name: "hosted hub", path: "/host", frame: ["dom", "skeleton", "hubReact", "settled"], host: ["handshake", "loaded"] },
  // Organization settings take a REST round trip in Azure DevOps; a warm visit's cached rows shouldn't wait for it.
  { name: "hosted hub, slow extension data", path: "/host?data=400", frame: ["dom", "skeleton", "hubReact", "settled"], host: ["handshake", "loaded"] },
  // On the Files tab, so the diff's wait counts too (prDiff).
  { name: "hosted PR", path: "/host?pr=471&repo=users-sdk&tab=files", frame: ["dom", "skeleton", "prSkeleton", "prReact", "prLive", "prDiff"], host: ["handshake", "loaded"] },
  // Each Azure DevOps REST call takes 250–500 ms (measured on a small organization), so the PR's data is most of the wait.
  { name: "hosted PR, slow REST", path: "/host?pr=471&repo=users-sdk&tab=files&api=400", frame: ["dom", "skeleton", "prSkeleton", "prReact", "prLive", "prDiff"], host: ["handshake", "loaded"] },
  // The same 250 to 520 ms, but each call its own. The page shows after the PR and its updates (data/adoOverview.ts), not the slowest call.
  { name: "hosted PR, uneven REST", path: "/host?pr=471&repo=users-sdk&tab=files&api=250&jitter=270", frame: ["dom", "skeleton", "prSkeleton", "prReact", "prLive", "prDiff"], host: ["handshake", "loaded"] },
  // A long discussion, so the threads and commits answer well after the small calls.
  { name: "hosted PR, slow threads", path: "/host?pr=471&repo=users-sdk&tab=files&api=300&heavy=900", frame: ["dom", "skeleton", "prSkeleton", "prReact", "prLive", "prDiff"], host: ["handshake", "loaded"] },
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
  return { page, frame, started, waitFor, problems };
}

async function measure(context, origin, scenario) {
  const { page, frame, started, waitFor } = await open(context, origin, scenario.path, scenario.host.length > 0);
  // Every landmark, not just the last: the diff and the buttons can land in either order.
  for (const mark of scenario.frame) await waitFor(mark);
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
    if (check) {
      await checkPartialNotKept(browser, origin);
      return;
    }
    if (calls) {
      await countCalls(browser, origin);
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

/**
 * A PR whose threads can't be read. The page shows the PR and its updates with an error, and keeps none of it in
 * this browser (data/prCache.ts), so the next open doesn't show the partial copy as the whole PR.
 */
async function checkPartialNotKept(browser, origin) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    // The threads fail after the PR and its updates land, so the partial shows first.
    const { frame } = await open(context, origin, "/host?pr=471&repo=users-sdk&api=100&heavy=600&fail=threads", true);
    await frame.getByText("Could not finish loading the pull request").waitFor({ timeout: 20_000 });
    const keptKeys = (f) => f.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("review-deck.pr.")));
    const kept = await keptKeys(frame);
    if (kept.length) throw new Error(`The partial PR was kept in this browser, in ${kept.join(", ")}`);
    // And the whole PR is, once it loads. Else the check above proves nothing.
    const whole = await open(context, origin, "/host?pr=471&repo=users-sdk", true);
    await whole.waitFor("prLive");
    if (!(await keptKeys(whole.frame)).length) throw new Error("The whole PR wasn't kept either, so this check proves nothing");
    console.log("A partial PR is not kept in the browser, the whole PR is.");
  } finally {
    await context.close();
  }
}

/**
 * The round the hub is for: the hub, a PR opened from one of its rows, the hub again, another PR (one that isn't
 * stacked), the hub again. Each step's REST calls, from the stub (preflights left out), once the step has been quiet
 * for a while, meaning no call for 600 ms and no "Updating…" bar. `--runs` rounds, each in a fresh browser profile,
 * so the first hub visit is cold. A second round in the same profile follows, where the hub starts from its kept rows.
 */
async function countCalls(browser, origin) {
  const rounds = { cold: [], warm: [] };
  for (let i = 0; i < runs; i++) {
    // Tall enough for all 20 rows. The hub fetches details for rows near the viewport, and a step that scrolled would start some.
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 1400 } });
    rounds.cold.push(await hubRound(context, origin));
    rounds.warm.push(await hubRound(context, origin));
    await context.close();
  }
  console.log(`root ${root}\nREST calls per step of hub → PR → hub, ${runs} rounds each in a fresh profile (cold) and again in it (warm). Medians; a step whose rounds differ lists them.\n`);
  for (const [label, samples] of Object.entries(rounds)) {
    console.log(label);
    for (const [s, step] of samples[0].entries()) {
      const counts = samples.map((round) => round[s].calls.length);
      const spread = new Set(counts).size > 1 ? ` (rounds: ${counts.join(", ")})` : "";
      console.log(`  ${step.name.padEnd(36)} ${String(median(counts)).padStart(4)}${spread}   ${breakdown(samples[0][s].calls)}`);
    }
  }
}

async function hubRound(context, origin) {
  let page, frame, problems;
  const steps = [];
  const step = async (name, act, lists = false) => {
    const started = Date.now();
    apiLog.length = 0;
    await act();
    // A step that lists isn't quiet before its list call, since the hub shows its kept rows well before that goes out.
    const listed = () => !lists || apiLog.some((c) => /\/pullrequests$/i.test(c.path));
    for (;;) {
      const last = Math.max(started, apiLog.at(-1)?.at ?? 0);
      // The hub's bar, where the hub shows; a PR page covers the hub, whose bar then says nothing about this step.
      const updating = await frame.evaluate(() => [...document.querySelectorAll(".hub-progress")].some((el) => el.getClientRects().length > 0));
      if (listed() && !updating && Date.now() - last > 600) break;
      if (Date.now() - started > 20_000) {
        const text = await frame.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => "");
        throw new Error(
          `${name}: not quiet after 20 s: ${apiLog.length} calls, listed ${listed()}, updating ${updating}.\n  last calls: ${apiLog.slice(-5).map((c) => c.path).join(", ") || "none"}\n  page text: ${JSON.stringify(text)}\n  errors: ${problems.join("\n          ") || "none"}`,
        );
      }
      await page.waitForTimeout(100);
    }
    steps.push({ name, calls: apiLog.map((c) => c.path) });
  };
  const openPr = (id) => async () => {
    await frame.click(`.pr-row[data-pr="${id}"]`);
    await frame.waitForSelector(LANDMARKS.prLive);
  };
  const back = async () => {
    await frame.click(".breadcrumb button.crumb-link");
    await frame.waitForSelector(LANDMARKS.hubRows, { state: "visible" });
  };
  // The page opens inside the step, since a warm visit's cached page has its first calls out before open() returns.
  await step(
    "hub, first visit",
    async () => {
      ({ page, frame, problems } = await open(context, origin, "/host", true));
      await frame.waitForSelector(LANDMARKS.hubRows);
    },
    true,
  );
  await step("PR 471 (stacked) from its row", openPr(471));
  await step("hub, back from the PR", back, true);
  await step("PR 454 (not stacked) from its row", openPr(454));
  await step("hub, back from the PR", back, true);
  await page.close();
  return steps;
}

/** The calls by what they ask for, in the order first seen, like "pullrequests 3, {id}/threads 20, …". */
function breakdown(paths) {
  const counts = new Map();
  for (const p of paths) {
    const short = p.replace(/^\/api\/(p1\/)?_apis\//, "").replace(/git\/repositories\/[^/]+\/pullRequests\//, "").replace(/\d+/g, "{id}");
    counts.set(short, (counts.get(short) ?? 0) + 1);
  }
  return [...counts].map(([path, n]) => `${path} ${n}`).join(", ");
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

  // The page's partial state, with the PR and its updates in and the threads and commits still on their way.
  const partial = await open(context, origin, "/host?pr=471&repo=users-sdk&api=300&heavy=8000", true);
  await partial.waitFor("prReact");
  await partial.page.waitForTimeout(500);
  await partial.page.screenshot({ path: join(dir, "3-pr-partial.png") });
  await partial.page.close();

  const local = await open(context, origin, "/dist/review.html?local=1&theme=dark", false);
  await local.waitFor("hubRows");
  await local.page.waitForTimeout(500);
  await local.page.screenshot({ path: join(dir, "4-local-hub-loaded.png") });
  // Hold the PR's data back, to see its skeleton filled in from the hub's cache.
  await local.page.route("**/dev-data/demo-*.json", async (route) => {
    await new Promise((ok) => setTimeout(ok, 3000));
    await route.continue();
  });
  await local.page.locator(".pr-row").first().click();
  await local.page.waitForTimeout(600);
  await local.page.screenshot({ path: join(dir, "5-local-pr-opening.png") });
  await local.waitFor("prReact");
  await local.page.waitForTimeout(500);
  await local.page.screenshot({ path: join(dir, "6-local-pr-loaded.png") });
  await context.close();
  console.log(`Screenshots in ${dir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
