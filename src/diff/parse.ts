import type { DiffLine, FileDiff, Hunk } from "../core/types.js";

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Parses `git diff` output into files and hunks with stable `<path>#<n>` IDs. */
export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let file: FileDiff | null = null;
  let hunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  const finishFile = () => {
    if (!file) return;
    file.path = file.status === "deleted" ? file.oldPath! : file.newPath!;
    file.hunks.forEach((h, i) => {
      h.path = file!.path;
      h.index = i;
      h.id = `${file!.path}#${i}`;
    });
    if (file.hunks.length === 0) file.hunks.push(pseudoHunk(file.path));
    files.push(file);
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      finishFile();
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      file = {
        path: "",
        oldPath: m?.[1] ?? null,
        newPath: m?.[2] ?? null,
        status: "modified",
        similarity: null,
        binary: false,
        headerLines: [line],
        hunks: [],
      };
      hunk = null;
      continue;
    }
    if (!file) continue;

    if (!hunk) {
      if (line.startsWith("@@")) {
        // fall through to hunk handling below
      } else {
        file.headerLines.push(line);
        if (line.startsWith("new file mode")) file.status = "added";
        else if (line.startsWith("deleted file mode")) file.status = "deleted";
        else if (line.startsWith("rename from ")) {
          file.oldPath = line.slice("rename from ".length);
          file.status = "renamed";
        } else if (line.startsWith("rename to ")) file.newPath = line.slice("rename to ".length);
        else if (line.startsWith("similarity index ")) file.similarity = Number.parseInt(line.slice(17), 10);
        else if (line.startsWith("Binary files ")) file.binary = true;
        else if (line.startsWith("--- ")) file.oldPath = line === "--- /dev/null" ? null : line.slice(6);
        else if (line.startsWith("+++ ")) file.newPath = line === "+++ /dev/null" ? null : line.slice(6);
        continue;
      }
    }

    const hm = HUNK_RE.exec(line);
    if (hm) {
      oldNo = Number(hm[1]);
      newNo = Number(hm[3]);
      hunk = {
        id: "",
        path: "",
        index: 0,
        header: line,
        oldStart: oldNo,
        oldLines: hm[2] === undefined ? 1 : Number(hm[2]),
        newStart: newNo,
        newLines: hm[4] === undefined ? 1 : Number(hm[4]),
        lines: [],
      };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;

    const tag = line[0];
    const body = line.slice(1);
    let dl: DiffLine | null = null;
    if (tag === "+") dl = { kind: "add", text: body, newLine: newNo++ };
    else if (tag === "-") dl = { kind: "del", text: body, oldLine: oldNo++ };
    else if (tag === " ") dl = { kind: "ctx", text: body, oldLine: oldNo++, newLine: newNo++ };
    // "\ No newline at end of file" and the trailing empty split element are ignored.
    if (dl) hunk.lines.push(dl);
  }
  finishFile();
  return files;
}

function pseudoHunk(path: string): Hunk {
  return {
    id: `${path}#0`,
    path,
    index: 0,
    header: "",
    oldStart: 0,
    oldLines: 0,
    newStart: 0,
    newLines: 0,
    lines: [],
  };
}

/** Reconstructs a standalone unified diff for one hunk (file header + hunk), for rendering. */
export function hunkToPatch(file: FileDiff, hunk: Hunk): string {
  return patchFor(file, [hunk]);
}

/** Reconstructs the unified diff for a whole file. */
export function fileToPatch(file: FileDiff): string {
  return patchFor(file, file.hunks);
}

function patchFor(file: FileDiff, hunks: Hunk[]): string {
  const header = file.headerLines.filter((l) => !l.startsWith("@@"));
  const real = hunks.filter((h) => h.header);
  if (real.length === 0) return `${header.join("\n")}\n`;
  if (!header.some((l) => l.startsWith("--- "))) {
    header.push(`--- ${file.oldPath ? `a/${file.oldPath}` : "/dev/null"}`, `+++ ${file.newPath ? `b/${file.newPath}` : "/dev/null"}`);
  }
  const body = real.flatMap((h) => [h.header, ...h.lines.map((l) => (l.kind === "add" ? "+" : l.kind === "del" ? "-" : " ") + l.text)]);
  return `${[...header, ...body].join("\n")}\n`;
}
