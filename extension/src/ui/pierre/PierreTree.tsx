import { FileTree, type GitStatusEntry } from "@pierre/trees";
import * as React from "react";
import type { FileDiff } from "../../../../src/core/types";
import { usePierreTheme } from "./theme";

/** Directory prefix shared by every path ("" when they diverge at the root), e.g. "apps/web/src/". */
export function commonDirectory(paths: string[]): string {
  if (paths.length === 0) return "";
  let dirs = paths[0].split("/").slice(0, -1);
  for (const path of paths.slice(1)) {
    const parts = path.split("/").slice(0, -1);
    let i = 0;
    while (i < dirs.length && dirs[i] === parts[i]) i++;
    dirs = dirs.slice(0, i);
  }
  return dirs.length ? `${dirs.join("/")}/` : "";
}

/** Colored per-language file icons (TypeScript blue, Terraform purple, …), like Zed's file tree. */
const ICONS = { set: "complete", colored: true } as const;

const svgUrl = (paths: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${paths}</svg>`)}")`;
const COMMENT_ICON = svgUrl(
  '<path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H7l-3 3v-3h-.5A1.5 1.5 0 0 1 2 9.5z"/>',
);
const FOLDER_ICON = svgUrl(
  '<path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.1l1.5 1.5H13A1.5 1.5 0 0 1 14.5 5.5v6.5A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12z" fill="none" stroke="black" stroke-width="1.2" stroke-linejoin="round"/>',
);
const FOLDER_OPEN_ICON = svgUrl(
  '<path d="M1.5 12V4A1.5 1.5 0 0 1 3 2.5h3.1l1.5 1.5H12A1.5 1.5 0 0 1 13.5 5.5V7M1.5 12l1.8-4.3A1 1 0 0 1 4.2 7H14a.7.7 0 0 1 .65.95L13 12.6a1.4 1.4 0 0 1-1.3.9H3A1.5 1.5 0 0 1 1.5 12z" fill="none" stroke="black" stroke-width="1.2" stroke-linejoin="round"/>',
);

/**
 * Graphite-style rows: the name is colored by status, so the A/M/D letter lane goes; the counts never
 * squeeze the name, and the comment count gets a speech-bubble icon. The tree only draws a chevron for
 * folders, so a folder icon (open when expanded) follows it, like Zed.
 */
const TREE_CSS = `
  [data-item-type="folder"] [data-item-section="icon"] { width: auto; gap: 4px; }
  [data-item-type="folder"] [data-item-section="icon"] > svg { flex-shrink: 0; }
  [data-item-type="folder"] [data-item-section="icon"]::after {
    content: ""; flex: 0 0 auto; width: 16px; height: 16px; background: var(--fg2);
    -webkit-mask: ${FOLDER_ICON} center / contain no-repeat; mask: ${FOLDER_ICON} center / contain no-repeat;
  }
  [data-item-type="folder"][aria-expanded="true"] [data-item-section="icon"]::after {
    -webkit-mask-image: ${FOLDER_OPEN_ICON}; mask-image: ${FOLDER_OPEN_ICON};
  }
  [data-item-section="git"] { display: none; }
  [data-item-section="decoration"] { flex: 0 0 auto; min-width: auto; overflow: visible; margin-left: auto; padding-left: 6px; white-space: nowrap; font-variant-numeric: tabular-nums; font-size: 11px; }
  [data-item-section="decoration"] span[style*="--fg2"] { display: inline-flex; align-items: center; gap: 2px; margin-left: 8px; }
  [data-item-section="decoration"] span[style*="--fg2"]::before {
    content: ""; width: 12px; height: 12px; background: currentColor;
    -webkit-mask: ${COMMENT_ICON} center / contain no-repeat; mask: ${COMMENT_ICON} center / contain no-repeat;
  }
`;

export const PierreTree: React.FC<{
  files: FileDiff[];
  onSelect(path: string): void;
  maxHeight?: number;
  /** Comment threads per full path, shown next to the line counts. */
  comments?: Map<string, number>;
  viewed?: ReadonlySet<string>;
}> = ({ files, onSelect, maxHeight = 360, comments, viewed }) => {
  const host = React.useRef<HTMLDivElement>(null);
  const instance = React.useRef<FileTree | null>(null);
  const theme = usePierreTheme();
  const current = React.useRef(onSelect);
  current.current = onSelect;
  // Narrow sidebar: drop the folders every file shares so rows show what differs instead of truncated paths.
  const prefix = commonDirectory(files.map((file) => file.path));
  const paths = files.map((file) => file.path.slice(prefix.length));
  const counts = files.map((file) => ({ ...lineCounts(file, comments?.get(file.path) ?? 0), viewed: viewed?.has(file.path) ?? false }));
  const identity = prefix + "\n" + paths.join("\n") + files.map((file) => file.status).join(",");
  const decorations = React.useRef(new Map(paths.map((path, i) => [path, counts[i]])));
  decorations.current = new Map(paths.map((path, i) => [path, counts[i]]));
  const decorationKey = counts.map(c => `${c.adds}/${c.dels}/${c.comments}/${c.viewed}`).join(",");
  React.useLayoutEffect(() => {
    if (!host.current) return;
    const gitStatus: GitStatusEntry[] = files.map((file, i) => ({ path: paths[i], status: file.status }));
    const tree = new FileTree({
      paths, gitStatus, initialExpansion: "open", density: "compact", icons: ICONS, unsafeCSS: TREE_CSS,
      renderRowDecoration: ({ item }) => {
        const count = decorations.current.get(item.path);
        return count ? countsDecoration(count) : null;
      },
      onSelectionChange: (selected) => {
        const path = selected.at(-1);
        if (path && paths.includes(path)) current.current(prefix + path);
      },
    });
    instance.current = tree;
    const resize = () => {
      if (host.current) host.current.style.height = `${Math.min(maxHeight, Math.max(36, tree.getVisibleCount() * tree.getItemHeight() + 8))}px`;
    };
    resize();
    const unsubscribe = tree.subscribe(resize);
    tree.render({ containerWrapper: host.current });
    // cleanUp() leaves its <file-tree-container> behind; drop it so a rebuild doesn't stack below an empty one.
    const mount = host.current;
    return () => { unsubscribe(); tree.cleanUp(); instance.current = null; mount.replaceChildren(); };
  }, [identity, maxHeight]);
  React.useLayoutEffect(() => {
    if (host.current) instance.current?.render({ containerWrapper: host.current });
  }, [decorationKey]);
  return (
    <div className="pierre-tree-wrap">
      {prefix && <div className="pierre-tree-prefix" title={prefix}>{prefix}</div>}
      <div className="pierre-tree" ref={host} data-renderer="pierre-trees" style={{ colorScheme: theme }} />
    </div>
  );
};

interface LineCounts {
  adds: number;
  dels: number;
  comments: number;
}

function lineCounts(file: FileDiff, comments: number): LineCounts {
  let adds = 0;
  let dels = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "add") adds++;
      else if (line.kind === "del") dels++;
    }
  }
  return { adds, dels, comments };
}

/** "+32 −2 [bubble]1" at the end of a file row, like Graphite's file list (TREE_CSS draws the bubble). */
function countsDecoration({ adds, dels, comments, viewed }: LineCounts & { viewed: boolean }) {
  const parts = [
    viewed ? { text: "✓ ", color: "var(--accent)" } : null,
    adds ? { text: `+${adds}`, color: "var(--ok)" } : null,
    dels ? { text: `${adds ? " " : ""}−${dels}`, color: "var(--err)" } : null,
    comments ? { text: String(comments), color: "var(--fg2)" } : null,
  ].filter((part) => part !== null);
  if (!parts.length) return null;
  const title = [viewed ? "Viewed" : "Not viewed", `${adds} added`, `${dels} removed`, comments ? `${comments} comment thread${comments === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
  return { text: parts.map((part) => part.text).join(""), title, parts };
}
