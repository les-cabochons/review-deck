import { Icon } from "azure-devops-ui/Icon";
import * as React from "react";
import type { FileDiff, Group, HunkInfo } from "../../../src/core/types";
import type { Iteration, Thread } from "../data/model";
import type { ReviewModel } from "../review/engine";
import { type DiffMode, DiffHunk, type ThreadIndex } from "./DiffHunk";
import { ThreadCard } from "./ThreadCard";
import { cx, plural } from "./util";

export type FileView = "grouped" | "alpha";

export const GROUP_COLORS = ["#0078d4", "#d97706", "#059669", "#db2777", "#7c3aed", "#0891b2", "#65a30d", "#dc2626"];

export function groupColor(groups: Group[], g: Group): string {
  if (g.kind !== "semantic") return "#8a8886";
  return GROUP_COLORS[groups.filter((x) => x.kind === "semantic").indexOf(g) % GROUP_COLORS.length];
}

interface Props {
  review: ReviewModel | null;
  loading: boolean;
  error: string | null;
  threads: Thread[];
  iterations: Iteration[];
  selection: { iteration: number; compareTo: number };
  onSelection: (s: { iteration: number; compareTo: number }) => void;
  view: FileView;
  onView: (v: FileView) => void;
  mode: DiffMode;
  onMode: (m: DiffMode) => void;
  /** Scroll target requested by another tab (group id). */
  focusGroup?: string | null;
}

export const FilesTab: React.FC<Props> = (props) => {
  const { review, view, mode } = props;
  const fileThreads = React.useMemo(() => indexThreads(props.threads), [props.threads]);

  React.useEffect(() => {
    if (props.focusGroup && review) document.getElementById(`group-${props.focusGroup}`)?.scrollIntoView({ block: "start" });
  }, [props.focusGroup, review]);

  return (
    <div className="files-tab">
      <Toolbar {...props} />
      {props.error && <div className="error-box">{props.error}</div>}
      {!review || props.loading ? (
        <div className="loading">Analyzing changes…</div>
      ) : (
        <div className="files-layout">
          <Navigator review={review} view={view} />
          <div className="files-content">
            {view === "grouped" ? (
              <GroupedView review={review} mode={mode} fileThreads={fileThreads} />
            ) : (
              <AlphaView review={review} mode={mode} fileThreads={fileThreads} />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const Toolbar: React.FC<Props> = ({ review, iterations, selection, onSelection, view, onView, mode, onMode }) => {
  const stats = review ? diffStats(review) : null;
  const latest = iterations.length;
  return (
    <div className="files-toolbar">
      <Segmented
        value={view}
        onChange={onView}
        options={[
          { value: "grouped", label: "Grouped", icon: "ViewListGroup" },
          { value: "alpha", label: "A–Z", icon: "SortLines" },
        ]}
      />
      <Segmented
        value={mode}
        onChange={onMode}
        options={[
          { value: "inline", label: "Inline", icon: "DiffInline" },
          { value: "split", label: "Side by side", icon: "DiffSideBySide" },
        ]}
      />
      <label className="compare">
        Compare
        <select
          value={selection.compareTo}
          onChange={(e) => onSelection({ ...selection, compareTo: Number(e.target.value) })}
          aria-label="Base"
        >
          <option value={0}>Base</option>
          {iterations
            .filter((it) => it.id < selection.iteration)
            .map((it) => (
              <option key={it.id} value={it.id}>
                Update {it.id}
              </option>
            ))}
        </select>
        <Icon iconName="Forward" />
        <select
          value={selection.iteration}
          onChange={(e) => {
            const iteration = Number(e.target.value);
            onSelection({ iteration, compareTo: Math.min(selection.compareTo, iteration - 1) });
          }}
          aria-label="Target"
        >
          {iterations.map((it) => (
            <option key={it.id} value={it.id}>
              Update {it.id}
              {it.id === latest ? " (latest)" : ""}
            </option>
          ))}
        </select>
      </label>
      {stats && (
        <span className="stats">
          {plural(stats.files, "file")} · <span className="adds">+{stats.adds}</span> <span className="dels">−{stats.dels}</span>
        </span>
      )}
    </div>
  );
};

function Segmented<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon: string }[];
}) {
  return (
    <div className="segmented" role="radiogroup">
      {props.options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={props.value === o.value}
          className={cx(props.value === o.value && "selected")}
          onClick={() => props.onChange(o.value)}
        >
          <Icon iconName={o.icon} /> {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- navigator ----------

const Navigator: React.FC<{ review: ReviewModel; view: FileView }> = ({ review, view }) => {
  const { result } = review;
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ block: "start" });
  if (view === "grouped") {
    return (
      <nav className="navigator">
        {result.groups.map((g, i) => (
          <div key={g.id} className="nav-group">
            <button className="nav-group-title" onClick={() => go(`group-${g.id}`)}>
              <span className="badge" style={{ background: groupColor(result.groups, g) }}>
                {i + 1}
              </span>
              <span className="text">{g.title}</span>
              <span className="count">{g.hunkIds.length}</span>
            </button>
            {g.kind === "semantic" &&
              unique(g.hunkIds.map((id) => result.hunks.get(id)!.file.path)).map((path) => (
                <button key={path} className="nav-file" onClick={() => go(`hunk-${g.hunkIds.find((h) => h.startsWith(`${path}#`))}`)}>
                  {basename(path)}
                </button>
              ))}
          </div>
        ))}
      </nav>
    );
  }
  const files = [...result.files].sort((a, b) => a.path.localeCompare(b.path));
  let lastDir = "";
  return (
    <nav className="navigator">
      {files.map((f) => {
        const dir = dirname(f.path);
        const header = dir !== lastDir ? <div className="nav-dir">{dir || "/"}</div> : null;
        lastDir = dir;
        return (
          <React.Fragment key={f.path}>
            {header}
            <button className="nav-file" onClick={() => go(`file-${f.path}`)}>
              <ChangeBadge file={f} /> {basename(f.path)}
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
};

// ---------- views ----------

interface ViewProps {
  review: ReviewModel;
  mode: DiffMode;
  fileThreads: Map<string, Thread[]>;
}

const GroupedView: React.FC<ViewProps> = ({ review, mode, fileThreads }) => {
  const { result } = review;
  const visible = visibleLines(result.files);
  const orphans = [...fileThreads].flatMap(([path, ts]) => ts.filter((t) => !isVisible(t, visible.get(path))).map((t) => ({ path, t })));
  return (
    <>
      {result.groups.map((g, i) => (
        <GroupSection key={g.id} group={g} index={i} review={review} mode={mode} fileThreads={fileThreads} />
      ))}
      {orphans.length > 0 && (
        <section className="group-section">
          <div className="group-header static">
            <span className="gtitle">Comments outside the changed lines</span>
            <span className="count">{plural(orphans.length, "thread")}</span>
          </div>
          {orphans.map(({ path, t }) => (
            <ThreadCard key={t.id} thread={t} fileLabel={`${path} · line ${t.file!.line}`} compact />
          ))}
        </section>
      )}
    </>
  );
};

const GroupSection: React.FC<{ group: Group; index: number } & ViewProps> = ({ group, index, review, mode, fileThreads }) => {
  const [open, setOpen] = React.useState(group.kind !== "mechanical");
  const hunks = group.hunkIds.map((id) => review.result.hunks.get(id)!);
  const files = new Set(hunks.map((h) => h.file.path)).size;
  return (
    <section className={cx("group-section", `kind-${group.kind}`)} id={`group-${group.id}`} style={{ borderLeftColor: groupColor(review.result.groups, group) }}>
      <button className="group-header" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon iconName={open ? "ChevronDown" : "ChevronRight"} />
        <span className="badge" style={{ background: groupColor(review.result.groups, group) }}>
          {index + 1}
        </span>
        <span className="gtitle">{group.title}</span>
        <span className="count">
          {plural(hunks.length, "change")} · {plural(files, "file")}
        </span>
      </button>
      {open && (
        <>
          {group.rationale && <p className="rationale">{group.rationale}</p>}
          {hunks.map((h) => (
            <HunkCard key={h.hunk.id} info={h} mode={mode} threads={lineIndex(fileThreads.get(h.file.path))} />
          ))}
        </>
      )}
    </section>
  );
};

const HunkCard: React.FC<{ info: HunkInfo; mode: DiffMode; threads: ThreadIndex }> = ({ info, mode, threads }) => {
  const adds = info.hunk.lines.filter((l) => l.kind === "add").length;
  const dels = info.hunk.lines.filter((l) => l.kind === "del").length;
  return (
    <article className="hunk-card" id={`hunk-${info.hunk.id}`}>
      <header className="file-header">
        <ChangeBadge file={info.file} />
        <FilePath path={info.file.path} from={info.file.status === "renamed" ? info.file.oldPath : null} />
        {info.isTest && <span className="tag">test</span>}
        {info.mechanical && <span className="tag">{info.mechanical.reason}</span>}
        <span className="spacer" />
        <span className="adds">+{adds}</span> <span className="dels">−{dels}</span>
      </header>
      <DiffHunk hunk={info.hunk} mode={mode} threads={threads} symbol={info.symbol} />
    </article>
  );
};

const AlphaView: React.FC<ViewProps> = ({ review, mode, fileThreads }) => {
  const files = [...review.result.files].sort((a, b) => a.path.localeCompare(b.path));
  const groupOf = new Map<string, Group>();
  review.result.groups.forEach((g) => g.hunkIds.forEach((id) => groupOf.set(id, g)));
  const visible = visibleLines(review.result.files);
  return (
    <>
      {files.map((f) => {
        const threads = fileThreads.get(f.path) ?? [];
        const orphans = threads.filter((t) => !isVisible(t, visible.get(f.path)));
        const index = lineIndex(threads);
        const adds = f.hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === "add").length, 0);
        const dels = f.hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === "del").length, 0);
        return (
          <article key={f.path} className="file-card" id={`file-${f.path}`}>
            <header className="file-header">
              <ChangeBadge file={f} />
              <FilePath path={f.path} from={f.status === "renamed" ? f.oldPath : null} />
              {f.hunks.map((h) => {
                const g = groupOf.get(h.id);
                return g ? (
                  <span key={h.id} className="group-chip" style={{ background: groupColor(review.result.groups, g) }} title={g.title}>
                    {review.result.groups.indexOf(g) + 1}
                  </span>
                ) : null;
              })}
              <span className="spacer" />
              <span className="adds">+{adds}</span> <span className="dels">−{dels}</span>
            </header>
            {orphans.map((t) => (
              <ThreadCard key={t.id} thread={t} fileLabel={`line ${t.file!.line} (outside the diff)`} compact />
            ))}
            {f.hunks.map((h) => (
              <DiffHunk key={h.id} hunk={h} mode={mode} threads={index} symbol={review.result.hunks.get(h.id)?.symbol} />
            ))}
          </article>
        );
      })}
    </>
  );
};

// ---------- helpers ----------

const ChangeBadge: React.FC<{ file: FileDiff }> = ({ file }) => {
  const letter = { added: "A", deleted: "D", renamed: "R", modified: "M" }[file.status];
  return (
    <span className={`change-badge change-${file.status}`} title={file.status}>
      {letter}
    </span>
  );
};

const FilePath: React.FC<{ path: string; from?: string | null }> = ({ path, from }) => (
  <span className="file-path" title={path}>
    {from && <span className="dir">{from} → </span>}
    <span className="dir">{dirname(path) ? `${dirname(path)}/` : ""}</span>
    <span className="name">{basename(path)}</span>
  </span>
);

function indexThreads(threads: Thread[]): Map<string, Thread[]> {
  const out = new Map<string, Thread[]>();
  for (const t of threads) {
    if (t.kind !== "comment" || !t.file) continue;
    out.set(t.file.path, [...(out.get(t.file.path) ?? []), t]);
  }
  return out;
}

function lineIndex(threads: Thread[] | undefined): ThreadIndex {
  const out: ThreadIndex = new Map();
  for (const t of threads ?? []) {
    const key = `${t.file!.side}:${t.file!.endLine}`;
    out.set(key, [...(out.get(key) ?? []), t]);
  }
  return out;
}

function visibleLines(files: FileDiff[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const f of files) {
    const set = new Set<string>();
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.newLine !== undefined && l.kind !== "del") set.add(`right:${l.newLine}`);
        if (l.oldLine !== undefined && l.kind === "del") set.add(`left:${l.oldLine}`);
      }
    }
    out.set(f.path, set);
  }
  return out;
}

function isVisible(t: Thread, visible: Set<string> | undefined): boolean {
  return !!visible?.has(`${t.file!.side}:${t.file!.endLine}`);
}

function diffStats(review: ReviewModel) {
  let adds = 0;
  let dels = 0;
  for (const f of review.result.files) {
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.kind === "add") adds++;
        else if (l.kind === "del") dels++;
      }
    }
  }
  return { files: review.result.files.length, adds, dels };
}

const unique = <T,>(xs: T[]) => [...new Set(xs)];
const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
