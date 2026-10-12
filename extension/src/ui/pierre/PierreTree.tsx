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

export const PierreTree: React.FC<{ files: FileDiff[]; onSelect(path: string): void; maxHeight?: number }> = ({ files, onSelect, maxHeight = 360 }) => {
  const host = React.useRef<HTMLDivElement>(null);
  const theme = usePierreTheme();
  const current = React.useRef(onSelect);
  current.current = onSelect;
  // Narrow sidebar: drop the folders every file shares so rows show what differs instead of truncated paths.
  const prefix = commonDirectory(files.map((file) => file.path));
  const paths = files.map((file) => file.path.slice(prefix.length));
  const identity = prefix + "\n" + paths.join("\n") + files.map((file) => file.status).join(",");
  React.useLayoutEffect(() => {
    if (!host.current) return;
    const gitStatus: GitStatusEntry[] = files.map((file, i) => ({ path: paths[i], status: file.status }));
    const tree = new FileTree({
      paths, gitStatus, initialExpansion: "open", density: "compact", icons: "standard",
      onSelectionChange: (selected) => {
        const path = selected.at(-1);
        if (path && paths.includes(path)) current.current(prefix + path);
      },
    });
    const resize = () => {
      if (host.current) host.current.style.height = `${Math.min(maxHeight, Math.max(36, tree.getVisibleCount() * tree.getItemHeight() + 8))}px`;
    };
    resize();
    const unsubscribe = tree.subscribe(resize);
    tree.render({ containerWrapper: host.current });
    return () => { unsubscribe(); tree.cleanUp(); };
  }, [identity, maxHeight]);
  return (
    <div className="pierre-tree-wrap">
      {prefix && <div className="pierre-tree-prefix" title={prefix}>{prefix}</div>}
      <div className="pierre-tree" ref={host} data-renderer="pierre-trees" style={{ colorScheme: theme }} />
    </div>
  );
};
