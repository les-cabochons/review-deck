import DOMPurify from "dompurify";
import { marked } from "marked";
import * as React from "react";
import type { Identity, ThreadStatus, Vote } from "../data/model";

export function ago(date: Date): string {
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  const units: [number, string][] = [
    [60, "minute"],
    [3600, "hour"],
    [86400, "day"],
    [86400 * 30, "month"],
    [86400 * 365, "year"],
  ];
  let [size, name] = units[0];
  for (const u of units) if (s >= u[0]) [size, name] = u;
  const n = Math.floor(s / size);
  return `${n} ${name}${n === 1 ? "" : "s"} ago`;
}

export function fullDate(date: Date): string {
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export const Time: React.FC<{ date: Date }> = ({ date }) => (
  <time dateTime={date.toISOString()} title={fullDate(date)}>
    {ago(date)}
  </time>
);

marked.setOptions({ gfm: true, breaks: false });

/** Display names for `@<id>` mention tokens (Azure DevOps stores mentions as identity ids). */
export const IdentityNames = React.createContext<Map<string, string>>(new Map());

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** GitHub/ADO-flavored markdown, sanitized, with `@<id>` mentions shown as names. */
export const Markdown: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  const names = React.useContext(IdentityNames);
  const html = React.useMemo(() => {
    const withMentions = (text || "").replace(/@<([^>\s]+)>/g, (_, id: string) => `<span class="mention">@${escapeHtml(names.get(id) ?? id)}</span>`);
    return DOMPurify.sanitize(marked.parse(withMentions, { async: false }) as string);
  }, [text, names]);
  if (!text.trim()) return <p className="muted">No description provided.</p>;
  return <div className={`markdown ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
};

export const Avatar: React.FC<{ who: Identity; size?: number }> = ({ who, size = 24 }) => {
  const [failed, setFailed] = React.useState(false);
  const initials = who.displayName
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return failed || !who.imageUrl ? (
    <span className="avatar initials" style={{ width: size, height: size, fontSize: size * 0.42 }} title={who.displayName}>
      {initials}
    </span>
  ) : (
    <img
      className="avatar"
      src={who.imageUrl}
      width={size}
      height={size}
      alt=""
      title={who.displayName}
      onError={() => setFailed(true)}
    />
  );
};

export const VOTE_INFO: Record<string, { label: string; icon: string; tone: string }> = {
  "10": { label: "Approved", icon: "CheckMark", tone: "success" },
  "5": { label: "Approved with suggestions", icon: "CheckMark", tone: "success" },
  "0": { label: "No vote", icon: "", tone: "neutral" },
  "-5": { label: "Waiting for author", icon: "Clock", tone: "warning" },
  "-10": { label: "Rejected", icon: "Cancel", tone: "error" },
};

export const voteInfo = (v: Vote) => VOTE_INFO[String(v)]!;

export const THREAD_STATUS_LABEL: Record<ThreadStatus, string> = {
  active: "Active",
  pending: "Pending",
  fixed: "Resolved",
  wontFix: "Won't fix",
  closed: "Closed",
  byDesign: "By design",
  unknown: "",
};

export const isOpen = (s: ThreadStatus) => s === "active" || s === "pending";

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? word : many}`;
}

export const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
export const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}
