import { parsePatchFiles, type AnnotationSide, type DiffLineAnnotation, type FileDiffMetadata } from "@pierre/diffs";
import type { FileDiff, Hunk } from "../../../../src/core/types";
import { hunkToPatch } from "../../../../src/diff/parse";
import { highlightLanguage } from "./languages";

export interface LineAnchor { side: "left" | "right"; line: number }
export const pierreSide = (side: LineAnchor["side"]): AnnotationSide => side === "left" ? "deletions" : "additions";
export const reviewSide = (side: AnnotationSide): LineAnchor["side"] => side === "deletions" ? "left" : "right";
export const anchorKey = (anchor: LineAnchor): string => `${anchor.side}:${anchor.line}`;

/** Parse exactly one pipeline hunk, preserving its original file coordinates. */
export function pierreHunk(file: FileDiff, hunk: Hunk): FileDiffMetadata {
  const parsed = parsePatchFiles(hunkToPatch(file, hunk), undefined, true);
  const metadata = parsed[0]?.files[0];
  if (!metadata) throw new Error(`Pierre could not parse ${hunk.id}`);
  metadata.lang = highlightLanguage(file.path);
  return metadata;
}

export function visibleAnchors(hunk: Hunk): Map<string, LineAnchor> {
  const anchors = new Map<string, LineAnchor>();
  for (const line of hunk.lines) {
    if (line.oldLine !== undefined && line.kind !== "add") {
      const anchor: LineAnchor = { side: "left", line: line.oldLine };
      anchors.set(anchorKey(anchor), anchor);
    }
    if (line.newLine !== undefined && line.kind !== "del") {
      const anchor: LineAnchor = { side: "right", line: line.newLine };
      anchors.set(anchorKey(anchor), anchor);
    }
  }
  return anchors;
}

export function lineAnnotations(hunk: Hunk, requested: Iterable<string>): DiffLineAnnotation<string>[] {
  const visible = visibleAnchors(hunk);
  return [...new Set(requested)].flatMap(key => {
    const anchor = visible.get(key);
    return anchor ? [{ side: pierreSide(anchor.side), lineNumber: anchor.line, metadata: key }] : [];
  });
}
