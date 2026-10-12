import { FileDiff, type DiffLineAnnotation, type FileDiffMetadata, type FileDiffOptions } from "@pierre/diffs";
import * as React from "react";
import { createPortal } from "react-dom";
import { reviewSide, type LineAnchor } from "./adapter";
import { usePierreTheme } from "./theme";

interface Props {
  metadata: FileDiffMetadata;
  mode: "inline" | "split";
  annotations: DiffLineAnnotation<string>[];
  renderAnnotation(key: string): React.ReactNode;
  onComment?: (anchor: LineAnchor) => void;
}

/** Pierre owns the diff DOM; React portals keep annotations in our review contexts. */
export const PierreDiff: React.FC<Props> = ({ metadata, mode, annotations, renderAnnotation, onComment }) => {
  const host = React.useRef<HTMLDivElement>(null);
  const instance = React.useRef<FileDiff<string> | null>(null);
  const current = React.useRef(onComment);
  current.current = onComment;
  const theme = usePierreTheme();
  const slots = React.useMemo(() => new Map<string, HTMLDivElement>(), [metadata]);
  for (const annotation of annotations) {
    if (!slots.has(annotation.metadata)) {
      const element = document.createElement("div");
      element.className = "pierre-annotation";
      slots.set(annotation.metadata, element);
    }
  }
  const options = (): FileDiffOptions<string, undefined> => ({
    diffStyle: mode === "inline" ? "unified" : "split",
    themeType: theme,
    disableFileHeader: true,
    hunkSeparators: "simple",
    diffIndicators: "classic",
    overflow: "wrap",
    lineDiffType: "word",
    preferredHighlighter: "shiki-js",
    enableGutterUtility: !!onComment,
    onLineNumberClick: event => current.current?.({ side: reviewSide(event.annotationSide), line: event.lineNumber }),
    onGutterUtilityClick: range => current.current?.({ side: reviewSide(range.side ?? "additions"), line: range.start }),
    renderAnnotation: annotation => slots.get(annotation.metadata),
  });

  React.useLayoutEffect(() => {
    const diff = new FileDiff<string>(options());
    instance.current = diff;
    return () => { diff.cleanUp(); instance.current = null; };
  }, [metadata]);
  React.useLayoutEffect(() => {
    const diff = instance.current;
    if (!diff || !host.current) return;
    diff.setOptions(options());
    diff.render({ fileDiff: metadata, containerWrapper: host.current, lineAnnotations: annotations });
  }, [metadata, mode, annotations, theme, !!onComment]);

  return <>
    <div className="pierre-diff" ref={host} data-renderer="pierre-diffs" />
    {annotations.map(annotation => createPortal(renderAnnotation(annotation.metadata), slots.get(annotation.metadata)!, annotation.metadata))}
  </>;
};
