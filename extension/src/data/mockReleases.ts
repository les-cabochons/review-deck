import type { Artifact, ArtifactFile, Commit, GitTag, GitTagDetails, PipelineRun, ReleaseCatalog, ReleaseSource } from "./releases";

/**
 * Local dev: a made-up repository's tags, commits and pipeline runs, so the Changelog hub can be worked on
 * without Azure DevOps. Descriptions are kept in localStorage.
 */
const DESCRIPTIONS_KEY = "review-deck.local.releaseDescriptions";
const DAY = 86_400_000;
const NOW = Date.now();

const AUTHORS = ["Maya Lindqvist", "Tomás Herrera", "Priya Natarajan", "Jonah Okafor"];

/** Per tag, oldest first: the commits since the previous tag, an annotation, and how its pipeline run went. */
const HISTORY: { tag: string; days: number; message?: string; run: "succeeded" | "failed" | "none"; commits: string[] }[] = [
  // Early previews, so the Release list has more than one page.
  ...Array.from({ length: 14 }, (_, i) => ({
    tag: `v0.0.${i + 1}`,
    days: 200 - i * 10,
    run: "succeeded" as const,
    commits: [i % 3 ? `fix: preview ${i + 1} fixes` : `feat: preview ${i + 1} feature`, "chore: tidy"],
  })),
  { tag: "v0.1.0", days: 60, message: "First public preview.", run: "succeeded", commits: ["feat: lantern sync engine", "feat(cli): init command", "docs: getting started"] },
  { tag: "v0.2.0", days: 41, run: "succeeded", commits: ["Merged PR 12: feat(ui): dark theme", "Merged PR 14: fix(sync): retry on timeout", "chore: bump dependencies", "Update README"] },
  { tag: "v0.3.0-rc.1", days: 25, run: "succeeded", commits: ["Merged PR 21: feat(api)!: rename /items to /lanterns", "Merged PR 22: perf(sync): batch writes", "test: cover conflict resolution"] },
  { tag: "v0.3.0-rc.2", days: 19, run: "failed", commits: ["Merged PR 27: fix(api): keep /items as an alias", "ci: cache node_modules"] },
  { tag: "v0.3.0", days: 14, message: "Lanterns everywhere.\n\nThe `/items` route is now `/lanterns`; the old one stays as an alias until 1.0.", run: "succeeded", commits: ["Merged PR 30: fix(ui): flicker on resize", "refactor: split the sync worker", "Merge branch 'main' into release"] },
  { tag: "v0.3.1", days: 3, run: "none", commits: ["Merged PR 33: fix(cli): exit code on failure", "Tidy logs"] },
  { tag: "experiment-ws", days: 10, run: "none", commits: ["try websockets"] },
];

const sha = (seed: string) => {
  let h = 0x811c9dc5;
  let out = "";
  for (let round = 0; out.length < 40; round++) {
    for (const ch of `${seed}:${round}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
    out += (h >>> 0).toString(16).padStart(8, "0");
  }
  return out.slice(0, 40);
};

const fakeDigest = (name: string) => (sha(name) + sha(`${name}!`)).slice(0, 64);

function textFile(path: string, text: string, date: Date): ArtifactFile {
  return { path, size: text.length, date, downloadUrl: `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`, read: async () => text };
}

function binary(path: string, mb: number, date: Date): ArtifactFile {
  return { path, size: Math.round(mb * 1024 * 1024), date, downloadUrl: "#", read: async () => "" };
}

function artifactsFor(tag: string, date: Date): Artifact[] {
  const version = tag.replace(/^v/, "");
  const windows = [binary(`lantern-${version}-win32-x64.zip`, 80.7, date), binary(`lantern-${version}-win32-arm64.zip`, 70.4, date)];
  const linux = [binary(`lantern-${version}-linux-x64.tar.gz`, 88.8, date), binary(`Lantern-${version}-amd64.deb`, 133, date), binary(`Lantern-${version}-arm64.AppImage`, 153, date)];
  const sums = [...windows, ...linux].map((f) => `${fakeDigest(f.path)}  ${f.path}`).join("\n");
  const manifests = [textFile("latest.yml", `version: ${version}\n`, date), textFile("latest-mac.yml", `version: ${version}\n`, date)];
  const groups: [string, ArtifactFile[]][] = [
    ["drop-windows", [...windows, textFile("SHA256SUMS", `${sums}\n`, date)]],
    ["drop-linux", linux],
    ["manifests", manifests],
  ];
  return [
    ...groups.map(([name, files]) => ({ name, size: files.reduce((n, f) => n + (f.size ?? 0), 0), zipUrl: "#", files: async () => files })),
    // An artifact that can't be listed: offered as a zip only.
    { name: "symbols", size: 42 * 1024 * 1024, zipUrl: "#", files: async () => null },
  ];
}

class MockReleaseSource implements ReleaseSource {
  readonly repository = { id: "lantern", name: "lantern" };

  async tags(): Promise<GitTag[]> {
    return HISTORY.map((h) => ({ name: h.tag, commitId: sha(`${h.tag}/0`), tagObjectId: h.message ? sha(`tag:${h.tag}`) : null }));
  }

  async tagDetails(tags: GitTag[]): Promise<Map<string, GitTagDetails>> {
    await delay(150);
    return new Map(
      tags.map((t) => {
        const h = HISTORY.find((x) => x.tag === t.name)!;
        return [t.name, { date: new Date(NOW - h.days * DAY), author: AUTHORS[HISTORY.indexOf(h) % AUTHORS.length], message: h.message ?? null }];
      }),
    );
  }

  async commits(from: GitTag | null, to: GitTag): Promise<Commit[]> {
    await delay(250);
    const end = HISTORY.findIndex((h) => h.tag === to.name);
    const start = from ? HISTORY.findIndex((h) => h.tag === from.name) : -1;
    const commits: Commit[] = [];
    for (let i = end; i > start; i--) {
      const h = HISTORY[i];
      if (h.tag === "experiment-ws" && to.name !== h.tag) continue;
      h.commits.forEach((message, j) =>
        commits.push({
          id: sha(`${h.tag}/${j}`),
          message,
          author: AUTHORS[(i + j) % AUTHORS.length],
          date: new Date(NOW - (h.days + j) * DAY),
          parents: message.startsWith("Merge branch") ? 2 : 1,
        }),
      );
    }
    return commits;
  }

  async latestRun(tag: GitTag): Promise<PipelineRun | null> {
    await delay(100);
    const h = HISTORY.find((x) => x.tag === tag.name);
    if (!h || h.run === "none") return null;
    const finished = new Date(NOW - h.days * DAY + 3_600_000);
    return { id: HISTORY.indexOf(h) + 100, pipeline: "lantern-publish", number: `${finished.toISOString().slice(0, 10).replace(/-/g, "")}.1`, result: h.run, finished, url: "#" };
  }

  async artifacts(run: PipelineRun): Promise<Artifact[]> {
    await delay(100);
    return run.result === "failed" ? [] : artifactsFor(HISTORY[run.id - 100].tag, run.finished ?? new Date());
  }

  async description(tag: string): Promise<string | null> {
    return readDescriptions()[tag] ?? null;
  }

  async saveDescription(tag: string, text: string): Promise<void> {
    const all = readDescriptions();
    if (text.trim()) all[tag] = text;
    else delete all[tag];
    localStorage.setItem(DESCRIPTIONS_KEY, JSON.stringify(all));
  }

  commitUrl(id: string): string {
    return `#commit-${id}`;
  }

  pullRequestUrl(id: number): string {
    return `#pr-${id}`;
  }

  compareUrl(base: string, target: string): string {
    return `#compare-${base}...${target}`;
  }
}

function readDescriptions(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(DESCRIPTIONS_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class MockReleaseCatalog implements ReleaseCatalog {
  private readonly lantern = new MockReleaseSource();

  async repositories() {
    return [this.lantern.repository];
  }

  async pipelines() {
    return [
      { id: 1, name: "lantern-ci" },
      { id: 2, name: "lantern-publish" },
    ];
  }

  source(): ReleaseSource {
    return this.lantern;
  }
}
