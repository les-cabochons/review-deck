import * as React from "react";
import type { FileAnchor, NewThread, PrActions, Vote } from "../../data/model";
import { readLocal, writeLocal } from "../preferences";

/**
 * A GitHub-style review: comments and replies collect as drafts (kept in local storage, so a reload
 * doesn't lose them) and are posted together with an optional vote and summary on submit.
 * Azure DevOps has no server-side batched review, so drafts are invisible to others until submitted.
 */
export type Draft =
  | { id: string; kind: "thread"; content: string; created: number; thread: NewThread }
  | { id: string; kind: "reply"; content: string; created: number; threadId: number; parentId: number };

export interface PendingReview {
  drafts: Draft[];
  addThread(thread: NewThread): void;
  addReply(threadId: number, parentId: number, content: string): void;
  update(id: string, content: string): void;
  remove(id: string): void;
  discard(): void;
  /** Posts drafts, then the summary, then the vote. Posted drafts are removed even if a later step fails. */
  submit(actions: PrActions, options: { vote: Vote | null; summary: string }): Promise<void>;
  draftsAt(file: FileAnchor["path"]): Extract<Draft, { kind: "thread" }>[];
  repliesTo(threadId: number): Extract<Draft, { kind: "reply" }>[];
}

const Context = React.createContext<PendingReview | null>(null);

export function usePendingReview(): PendingReview {
  const value = React.useContext(Context);
  if (!value) throw new Error("usePendingReview needs a PendingReviewProvider.");
  return value;
}

let nextId = 0;
const newId = () => `draft-${Date.now().toString(36)}-${++nextId}`;

export const PendingReviewProvider: React.FC<{ storageKey: string }> = ({ storageKey, children }) => {
  const key = `pending.${storageKey}`;
  const [drafts, setDrafts] = React.useState<Draft[]>(() => {
    try {
      return JSON.parse(readLocal(key) || "[]") as Draft[];
    } catch {
      return [];
    }
  });
  const latest = React.useRef(drafts);
  const save = React.useCallback(
    (next: Draft[]) => {
      latest.current = next;
      setDrafts(next);
      writeLocal(key, JSON.stringify(next));
    },
    [key],
  );

  const value = React.useMemo<PendingReview>(
    () => ({
      drafts,
      addThread: (thread) => save([...latest.current, { id: newId(), kind: "thread", content: thread.content, created: Date.now(), thread }]),
      addReply: (threadId, parentId, content) =>
        save([...latest.current, { id: newId(), kind: "reply", content, created: Date.now(), threadId, parentId }]),
      update: (id, content) =>
        save(
          latest.current.map((d) =>
            d.id !== id ? d : d.kind === "thread" ? { ...d, content, thread: { ...d.thread, content } } : { ...d, content },
          ),
        ),
      remove: (id) => save(latest.current.filter((d) => d.id !== id)),
      discard: () => save([]),
      async submit(actions, { vote, summary }) {
        for (const draft of [...latest.current]) {
          if (draft.kind === "thread") await actions.createThread({ ...draft.thread, content: draft.content });
          else await actions.reply(draft.threadId, draft.parentId, draft.content);
          save(latest.current.filter((d) => d.id !== draft.id));
        }
        if (summary.trim()) await actions.createThread({ content: summary });
        if (vote !== null) await actions.setVote(vote);
      },
      draftsAt: (path) => drafts.filter((d): d is Extract<Draft, { kind: "thread" }> => d.kind === "thread" && d.thread.file?.path === path),
      repliesTo: (threadId) => drafts.filter((d): d is Extract<Draft, { kind: "reply" }> => d.kind === "reply" && d.threadId === threadId),
    }),
    [drafts, save],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
};
