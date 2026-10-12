import * as React from "react";
import type { PrOverview } from "../data/model";
import { Time } from "./util";

/** Commits grouped by the update (iteration) that pushed them, newest first, like the native Commits tab. */
export const CommitsTab: React.FC<{ data: PrOverview }> = ({ data }) => {
  const byId = new Map(data.commits.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const sections = [...data.iterations]
    .reverse()
    .map((it) => {
      const commits = it.commitIds.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
      commits.forEach((c) => seen.add(c.id));
      return { it, commits: [...commits].reverse() };
    });
  const loose = data.commits.filter((c) => !seen.has(c.id));
  return (
    <div className="commits-tab">
      {sections.map(({ it, commits }) => (
        <section key={it.id} className="commit-section">
          <h3>
            Update {it.id} <span className="muted">· {it.author.displayName} · <Time date={it.createdDate} /></span>
          </h3>
          <CommitList commits={commits} />
        </section>
      ))}
      {loose.length > 0 && (
        <section className="commit-section">
          <h3>Commits</h3>
          <CommitList commits={loose} />
        </section>
      )}
    </div>
  );
};

const CommitList: React.FC<{ commits: PrOverview["commits"] }> = ({ commits }) => (
  <ul className="commit-list">
    {commits.length === 0 && <li className="muted">No commit details for this update.</li>}
    {commits.map((c) => {
      const [subject, ...body] = c.message.split("\n");
      return (
        <li key={c.id}>
          <div className="commit-subject">{subject}</div>
          {body.join("\n").trim() && <details className="commit-body"><summary>…</summary><pre>{body.join("\n").trim()}</pre></details>}
          <div className="commit-meta muted">
            <code>{c.id.slice(0, 8)}</code> · {c.authorName} · <Time date={c.date} />
          </div>
        </li>
      );
    })}
  </ul>
);
