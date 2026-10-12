import { diffWordsWithSpace } from "diff";
import * as React from "react";
import type { DiffLine, Hunk } from "../../../src/core/types";
import type { Thread } from "../data/model";
import { ThreadCard } from "./ThreadCard";
import { CommentComposer } from "./CommentComposer";
import { LineCommentContext } from "./LineComments";
import { useReviewActions } from "./ReviewActions";
import { DraftCard } from "./review/DraftCard";
import { type Draft, usePendingReview } from "./review/PendingReview";

export type DiffMode = "inline" | "split";

/** Threads anchored in this file, keyed by `${side}:${line}`. */
export type ThreadIndex = Map<string, Thread[]>;

interface Props {
  filePath: string;
  hunk: Hunk;
  mode: DiffMode;
  threads: ThreadIndex;
  /** Shown in the hunk header after the @@ range (the enclosing symbol). */
  symbol?: string | null;
}

/** Renders one hunk as a table, inline (unified) or side by side, with comment threads under their lines. */
export const DiffHunk: React.FC<Props> = ({ hunk, mode, threads, symbol, filePath }) => {
  const comments = React.useContext(LineCommentContext);
  const { actions, disabled } = useReviewActions();
  const pending = usePendingReview();
  const [anchor, setAnchor] = React.useState<{ side: "left" | "right"; line: number } | null>(null);
  const onComment =
    comments?.canComment(filePath) && !disabled ? (side: "left" | "right", line: number) => setAnchor({ side, line }) : undefined;
  if (!hunk.header) return <div className="diff-note">No content changes (rename or mode change only).</div>;
  const rows = mode === "inline" ? inlineRows(hunk.lines) : splitRows(hunk.lines);
  const range = hunk.header.match(/^@@[^@]+@@/)?.[0] ?? hunk.header;
  const span = mode === "inline" ? 3 : 4;
  const drafts = new Map<string, Draft[]>();
  for (const d of pending.draftsAt(filePath)) {
    const f = d.thread.file!;
    drafts.set(`${f.side}:${f.endLine}`, [...(drafts.get(`${f.side}:${f.endLine}`) ?? []), d]);
  }
  const inReview = pending.drafts.length > 0;
  return (
    <table className={`diff diff-${mode}`}>
      <colgroup>
        {mode === "inline" ? (
          <>
            <col className="col-num" />
            <col className="col-num" />
            <col />
          </>
        ) : (
          <>
            <col className="col-num" />
            <col className="col-half" />
            <col className="col-num" />
            <col className="col-half" />
          </>
        )}
      </colgroup>
      <tbody>
        <tr className="diff-hunk-header">
          <td colSpan={span}>
            <span className="range">{range}</span> {symbol && <span className="hunk-symbol">{symbol}</span>}
          </td>
        </tr>
        {rows.map((row, i) => {
          const keys = rowKeys(row);
          return (
            <React.Fragment key={i}>
              {mode === "inline" ? (
                <InlineRow row={row as InlineRowData} onComment={onComment} />
              ) : (
                <SplitRow row={row as SplitRowData} onComment={onComment} />
              )}
              {keys.flatMap((k) => threads.get(k) ?? []).map((t) => (
                <tr key={`t${t.id}`} className="diff-thread-row">
                  <td colSpan={span}>
                    <ThreadCard thread={t} compact />
                  </td>
                </tr>
              ))}
              {keys.flatMap((k) => drafts.get(k) ?? []).map((d) => (
                <tr key={d.id} className="diff-thread-row">
                  <td colSpan={span}>
                    <DraftCard draft={d} />
                  </td>
                </tr>
              ))}
              {anchor && rowHasAnchor(row, anchor) && (
                <tr className="diff-thread-row">
                  <td colSpan={span}>
                    <CommentComposer
                      label={`Comment on ${filePath}, ${anchor.side} line ${anchor.line}`}
                      onCancel={() => setAnchor(null)}
                      onSaved={() => setAnchor(null)}
                      actions={[
                        {
                          text: inReview ? "Add review comment" : "Start a review",
                          local: true,
                          onSave: (content) => pending.addThread(comments!.toThread({ path: filePath, ...anchor, endLine: anchor.line }, content)),
                        },
                        {
                          text: inReview ? "Comment now" : "Add single comment",
                          onSave: (content) => actions.createThread(comments!.toThread({ path: filePath, ...anchor, endLine: anchor.line }, content)),
                        },
                      ]}
                    />
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
};

interface Cell {
  kind: DiffLine["kind"];
  no?: number;
  content: React.ReactNode;
  side: "left" | "right";
}
interface InlineRowData {
  old?: number;
  new?: number;
  kind: DiffLine["kind"];
  content: React.ReactNode;
}
interface SplitRowData {
  left?: Cell;
  right?: Cell;
}

function rowKeys(row: InlineRowData | SplitRowData): string[] {
  const keys: string[] = [];
  if ("kind" in row) {
    if (row.new !== undefined && row.kind !== "del") keys.push(`right:${row.new}`);
    if (row.old !== undefined && row.kind !== "add") keys.push(`left:${row.old}`);
  } else {
    if (row.right?.no !== undefined) keys.push(`right:${row.right.no}`);
    if (row.left?.no !== undefined) keys.push(`left:${row.left.no}`);
  }
  return keys;
}

function rowHasAnchor(row: InlineRowData | SplitRowData, anchor: { side: "left" | "right"; line: number }): boolean {
  return "kind" in row ? (anchor.side === "left" ? row.old : row.new) === anchor.line : row[anchor.side]?.no === anchor.line;
}

/** Groups a hunk into runs: context lines, or a change block (dels followed by adds). */
function blocks(lines: DiffLine[]): { ctx?: DiffLine; dels: DiffLine[]; adds: DiffLine[] }[] {
  const out: { ctx?: DiffLine; dels: DiffLine[]; adds: DiffLine[] }[] = [];
  let cur: { dels: DiffLine[]; adds: DiffLine[] } | null = null;
  for (const l of lines) {
    if (l.kind === "ctx") {
      if (cur) out.push(cur);
      cur = null;
      out.push({ ctx: l, dels: [], adds: [] });
    } else {
      if (!cur || (l.kind === "del" && cur.adds.length > 0)) {
        if (cur) out.push(cur);
        cur = { dels: [], adds: [] };
      }
      (l.kind === "del" ? cur.dels : cur.adds).push(l);
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Word-level highlights for a paired del/add line. */
function wordDiff(oldText: string, newText: string): [React.ReactNode, React.ReactNode] {
  if (oldText.length + newText.length > 1000) return [oldText, newText];
  const parts = diffWordsWithSpace(oldText, newText);
  const changed = parts.filter((p) => p.added || p.removed).reduce((n, p) => n + p.value.length, 0);
  if (changed > 0.7 * Math.max(oldText.length, newText.length)) return [oldText, newText]; // mostly rewritten: no noise
  const left = parts.filter((p) => !p.added).map((p, i) => (p.removed ? <mark key={i}>{p.value}</mark> : p.value));
  const right = parts.filter((p) => !p.removed).map((p, i) => (p.added ? <mark key={i}>{p.value}</mark> : p.value));
  return [left, right];
}

function pairedContents(dels: DiffLine[], adds: DiffLine[]): { del: React.ReactNode[]; add: React.ReactNode[] } {
  const del: React.ReactNode[] = dels.map((d) => d.text);
  const add: React.ReactNode[] = adds.map((a) => a.text);
  if (dels.length === adds.length) {
    dels.forEach((d, i) => {
      [del[i], add[i]] = wordDiff(d.text, adds[i].text);
    });
  }
  return { del, add };
}

function inlineRows(lines: DiffLine[]): InlineRowData[] {
  const rows: InlineRowData[] = [];
  for (const b of blocks(lines)) {
    if (b.ctx) {
      rows.push({ old: b.ctx.oldLine, new: b.ctx.newLine, kind: "ctx", content: b.ctx.text });
      continue;
    }
    const { del, add } = pairedContents(b.dels, b.adds);
    b.dels.forEach((d, i) => rows.push({ old: d.oldLine, kind: "del", content: del[i] }));
    b.adds.forEach((a, i) => rows.push({ new: a.newLine, kind: "add", content: add[i] }));
  }
  return rows;
}

function splitRows(lines: DiffLine[]): SplitRowData[] {
  const rows: SplitRowData[] = [];
  for (const b of blocks(lines)) {
    if (b.ctx) {
      rows.push({
        left: { kind: "ctx", no: b.ctx.oldLine, content: b.ctx.text, side: "left" },
        right: { kind: "ctx", no: b.ctx.newLine, content: b.ctx.text, side: "right" },
      });
      continue;
    }
    const { del, add } = pairedContents(b.dels, b.adds);
    for (let i = 0; i < Math.max(b.dels.length, b.adds.length); i++) {
      rows.push({
        left: b.dels[i] ? { kind: "del", no: b.dels[i].oldLine, content: del[i], side: "left" } : undefined,
        right: b.adds[i] ? { kind: "add", no: b.adds[i].newLine, content: add[i], side: "right" } : undefined,
      });
    }
  }
  return rows;
}

const SIGN = { add: "+", del: "-", ctx: " " } as const;

type OnComment = (side: "left" | "right", line: number) => void;
const LineNumber: React.FC<{ no?: number; side: "left" | "right"; onComment?: OnComment }> = ({ no, side, onComment }) =>
  no === undefined ? null : onComment ? (
    <button className="line-comment-button" aria-label={`Comment on ${side} line ${no}`} onClick={() => onComment(side, no)}>
      {no}
      <span aria-hidden="true">+</span>
    </button>
  ) : (
    <>{no}</>
  );

const InlineRow: React.FC<{ row: InlineRowData; onComment?: OnComment }> = ({ row, onComment }) => (
  <tr className={`line ${row.kind}`}>
    <td className="num">
      <LineNumber no={row.old} side="left" onComment={onComment} />
    </td>
    <td className="num">
      <LineNumber no={row.new} side="right" onComment={onComment} />
    </td>
    <td className="code">
      <span className="sign">{SIGN[row.kind]}</span>
      {row.content}
    </td>
  </tr>
);

const SplitRow: React.FC<{ row: SplitRowData; onComment?: OnComment }> = ({ row, onComment }) => (
  <tr className="line">
    <td className={`num ${row.left?.kind ?? "empty"}`}>
      <LineNumber no={row.left?.no} side="left" onComment={onComment} />
    </td>
    <td className={`code ${row.left?.kind ?? "empty"}`}>
      {row.left && <span className="sign">{SIGN[row.left.kind]}</span>}
      {row.left?.content}
    </td>
    <td className={`num ${row.right?.kind ?? "empty"}`}>
      <LineNumber no={row.right?.no} side="right" onComment={onComment} />
    </td>
    <td className={`code ${row.right?.kind ?? "empty"}`}>
      {row.right && <span className="sign">{SIGN[row.right.kind]}</span>}
      {row.right?.content}
    </td>
  </tr>
);
