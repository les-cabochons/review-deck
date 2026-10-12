// Pure markdown editing transforms used by the comment editor toolbar and shortcuts.

export interface EditState {
  text: string;
  start: number;
  end: number;
}

/** Wraps the selection in `before`/`after` (toggles off if it is already wrapped). */
export function wrap(s: EditState, before: string, after = before, placeholder = "text"): EditState {
  const selected = s.text.slice(s.start, s.end);
  const outer = s.text.slice(Math.max(0, s.start - before.length), s.end + after.length);
  if (selected && outer === `${before}${selected}${after}`) {
    const text = s.text.slice(0, s.start - before.length) + selected + s.text.slice(s.end + after.length);
    return { text, start: s.start - before.length, end: s.end - before.length };
  }
  const inner = selected || placeholder;
  const text = s.text.slice(0, s.start) + before + inner + after + s.text.slice(s.end);
  return { text, start: s.start + before.length, end: s.start + before.length + inner.length };
}

const ANY_PREFIX = /^(?:[-*] \[[ x]\] |[-*] |\d+\. |> ?|#{1,6} )/;

export const LINE_KINDS = {
  bullet: { prefix: () => "- ", detect: /^[-*] (?!\[[ x]\] )/ },
  numbered: { prefix: (i: number) => `${i + 1}. `, detect: /^\d+\. / },
  checklist: { prefix: () => "- [ ] ", detect: /^[-*] \[[ x]\] / },
  quote: { prefix: () => "> ", detect: /^> ?/ },
  heading: { prefix: () => "### ", detect: /^#{1,6} / },
} as const;

/**
 * Turns every selected line into `kind` (bullet, numbered, checklist, quote, heading), replacing any
 * other line prefix; removes it instead when every line already has it.
 */
export function prefixLines(s: EditState, kind: keyof typeof LINE_KINDS): EditState {
  const { prefix, detect } = LINE_KINDS[kind];
  const lineStart = s.text.lastIndexOf("\n", s.start - 1) + 1;
  const nextBreak = s.text.indexOf("\n", s.end);
  const lineEnd = nextBreak === -1 ? s.text.length : nextBreak;
  const lines = s.text.slice(lineStart, lineEnd).split("\n");
  const allPrefixed = lines.every((l) => detect.test(l));
  const next = allPrefixed ? lines.map((l) => l.replace(detect, "")) : lines.map((l, i) => prefix(i) + l.replace(ANY_PREFIX, ""));
  const block = next.join("\n");
  const text = s.text.slice(0, lineStart) + block + s.text.slice(lineEnd);
  return { text, start: lineStart, end: lineStart + block.length };
}

/** `[selection](url)` with "url" selected for typing. */
export function link(s: EditState): EditState {
  const label = s.text.slice(s.start, s.end) || "link text";
  const before = `[${label}](`;
  const text = s.text.slice(0, s.start) + before + "url)" + s.text.slice(s.end);
  const start = s.start + before.length;
  return { text, start, end: start + 3 };
}

/** Inline code for single-line selections, a fenced block for multi-line ones. */
export function code(s: EditState): EditState {
  const selected = s.text.slice(s.start, s.end);
  if (!selected.includes("\n")) return wrap(s, "`", "`", "code");
  const block = `\n\`\`\`\n${selected}\n\`\`\`\n`;
  const text = s.text.slice(0, s.start) + block + s.text.slice(s.end);
  return { text, start: s.start + 5, end: s.start + 5 + selected.length };
}

/** Markdown blockquote of `text`, followed by a blank line ready for the reply. */
export function quote(text: string, author?: string): string {
  const body = text
    .trim()
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return `${author ? `> **${author}** wrote:\n>\n` : ""}${body}\n\n`;
}

/** The `@query` being typed right before the caret, if any. */
export function mentionQuery(s: EditState): { query: string; start: number } | null {
  if (s.start !== s.end) return null;
  const before = s.text.slice(0, s.start);
  const m = /(^|\s)@([^\s@<>]{0,40})$/.exec(before);
  return m ? { query: m[2], start: s.start - m[2].length - 1 } : null;
}

/** Replaces the `@query` with an Azure DevOps mention token `@<id>`. */
export function insertMention(s: EditState, at: number, id: string): EditState {
  const token = `@<${id}> `;
  const text = s.text.slice(0, at) + token + s.text.slice(s.start);
  const caret = at + token.length;
  return { text, start: caret, end: caret };
}
