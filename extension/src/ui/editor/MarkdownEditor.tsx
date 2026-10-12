import { Icon } from "azure-devops-ui/Icon";
import * as React from "react";
import type { Identity } from "../../data/model";
import { Avatar, cx, Markdown } from "../util";
import { code, type EditState, insertMention, link, mentionQuery, prefixLines, wrap } from "./format";

/** People offered in `@` mention suggestions, plus an optional directory search. */
export interface MentionSource {
  known: Identity[];
  search?: (query: string) => Promise<Identity[]>;
}
export const MentionContext = React.createContext<MentionSource>({ known: [] });

type Tool = { id: string; title: string; icon?: string; glyph?: string; key?: string; apply: (s: EditState) => EditState };

const TOOLS: (Tool | "|")[] = [
  { id: "heading", title: "Heading", icon: "FontSize", apply: (s) => prefixLines(s, "heading") },
  { id: "bold", title: "Bold (Ctrl+B)", icon: "Bold", key: "b", apply: (s) => wrap(s, "**", "**", "bold text") },
  { id: "italic", title: "Italic (Ctrl+I)", icon: "Italic", key: "i", apply: (s) => wrap(s, "_", "_", "italic text") },
  { id: "strike", title: "Strikethrough", icon: "Strikethrough", apply: (s) => wrap(s, "~~", "~~", "text") },
  "|",
  { id: "quote", title: "Quote", glyph: "❝", apply: (s) => prefixLines(s, "quote") },
  { id: "code", title: "Code (Ctrl+E)", icon: "Code", key: "e", apply: code },
  { id: "link", title: "Link (Ctrl+K)", icon: "Link", key: "k", apply: link },
  "|",
  { id: "bullets", title: "Bulleted list", icon: "BulletedList", apply: (s) => prefixLines(s, "bullet") },
  { id: "numbers", title: "Numbered list", icon: "NumberedList", apply: (s) => prefixLines(s, "numbered") },
  { id: "tasks", title: "Checklist", icon: "CheckList", apply: (s) => prefixLines(s, "checklist") },
  "|",
  {
    id: "mention",
    title: "Mention someone",
    glyph: "@",
    apply: (s) => {
      const pad = s.start > 0 && !/\s/.test(s.text[s.start - 1]) ? " " : "";
      const text = `${s.text.slice(0, s.start)}${pad}@${s.text.slice(s.end)}`;
      const caret = s.start + pad.length + 1;
      return { text, start: caret, end: caret };
    },
  },
];

export interface MarkdownEditorHandle {
  focus(): void;
}

/**
 * Write/Preview markdown editor with an Azure DevOps-style formatting toolbar, shortcuts
 * (Ctrl+B/I/E/K, Ctrl+Enter to submit, Esc to cancel) and `@` mention suggestions.
 */
export const MarkdownEditor = React.forwardRef<
  MarkdownEditorHandle,
  {
    value: string;
    onChange: (value: string) => void;
    label: string;
    placeholder?: string;
    disabled?: boolean;
    autoFocus?: boolean;
    minRows?: number;
    onSubmit?: () => void;
    onCancel?: () => void;
  }
>(({ value, onChange, label, placeholder, disabled, autoFocus, minRows = 3, onSubmit, onCancel }, ref) => {
  const area = React.useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = React.useState(false);
  const [caret, setCaret] = React.useState({ start: value.length, end: value.length });
  const mentions = useMentions({ text: value, ...caret });
  React.useImperativeHandle(ref, () => ({ focus: () => area.current?.focus() }));

  // Grow with content.
  React.useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, minRows * 20 + 16)}px`;
  }, [value, preview, minRows]);

  const apply = (next: EditState) => {
    onChange(next.text);
    setCaret({ start: next.start, end: next.end });
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.start, next.end);
    });
  };
  const state = (): EditState => ({ text: value, start: area.current?.selectionStart ?? value.length, end: area.current?.selectionEnd ?? value.length });

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentions.open && mentions.onKeyDown(e, apply, state())) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      onSubmit?.();
    } else if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      onCancel();
    } else if (mod && !e.shiftKey && !e.altKey) {
      const tool = TOOLS.find((t): t is Tool => t !== "|" && t.key === e.key.toLowerCase());
      if (tool) {
        e.preventDefault();
        apply(tool.apply(state()));
      }
    }
  };

  return (
    <div className={cx("md-editor", disabled && "is-disabled")}>
      <div className="md-editor-bar">
        <div className="md-tabs" role="tablist" aria-label={`${label} mode`}>
          <button type="button" role="tab" aria-selected={!preview} className={cx(!preview && "selected")} onClick={() => setPreview(false)}>
            Write
          </button>
          <button type="button" role="tab" aria-selected={preview} className={cx(preview && "selected")} onClick={() => setPreview(true)}>
            Preview
          </button>
        </div>
        {!preview && (
          <div className="md-toolbar" role="toolbar" aria-label="Formatting">
            {TOOLS.map((t, i) =>
              t === "|" ? (
                <span key={i} className="md-sep" />
              ) : (
                <button
                  key={t.id}
                  type="button"
                  className="md-tool"
                  title={t.title}
                  aria-label={t.title}
                  disabled={disabled}
                  onMouseDown={(e) => e.preventDefault() /* keep the selection */}
                  onClick={() => apply(t.apply(state()))}
                >
                  {t.icon ? <Icon iconName={t.icon} /> : <span className="md-glyph">{t.glyph}</span>}
                </button>
              ),
            )}
          </div>
        )}
      </div>
      {preview ? (
        <div className="md-preview">{value.trim() ? <Markdown text={value} /> : <p className="muted">Nothing to preview.</p>}</div>
      ) : (
        <div className="md-input">
          <textarea
            ref={area}
            aria-label={label}
            placeholder={placeholder ?? "Add a comment. Markdown and @mentions are supported."}
            value={value}
            disabled={disabled}
            autoFocus={autoFocus}
            onChange={(e) => {
              onChange(e.target.value);
              setCaret({ start: e.target.selectionStart, end: e.target.selectionEnd });
            }}
            onSelect={(e) => setCaret({ start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd })}
            onKeyDown={onKeyDown}
          />
          {mentions.open && mentions.render((who, at) => apply(insertMention(state(), at, who.id)))}
        </div>
      )}
    </div>
  );
});

/** `@` suggestions: known people first, then a debounced directory search. */
function useMentions(s: EditState) {
  const source = React.useContext(MentionContext);
  const query = mentionQuery(s);
  const [found, setFound] = React.useState<Identity[]>([]);
  const [active, setActive] = React.useState(0);
  const q = query?.query.toLowerCase() ?? null;

  React.useEffect(() => {
    setActive(0);
    if (q === null || q.length < 2 || !source.search) {
      setFound([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      source.search!(q)
        .then((people) => !cancelled && setFound(people))
        .catch(() => !cancelled && setFound([]));
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q, source]);

  const matches = React.useMemo(() => {
    if (q === null) return [];
    const seen = new Set<string>();
    return [...source.known, ...found]
      .filter((p) => (p.displayName + " " + p.uniqueName).toLowerCase().includes(q))
      .filter((p) => !seen.has(p.id) && seen.add(p.id))
      .slice(0, 6);
  }, [q, source.known, found]);

  const open = query !== null && matches.length > 0;
  return {
    open,
    onKeyDown(e: React.KeyboardEvent, apply: (s: EditState) => void, state: EditState): boolean {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        apply(insertMention(state, query!.start, matches[active].id));
        return true;
      }
      return e.key === "Escape";
    },
    render(choose: (who: Identity, at: number) => void) {
      return (
        <ul className="mention-list" role="listbox" aria-label="People">
          {matches.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}>
              <button type="button" className={cx(i === active && "active")} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(p, query!.start)}>
                <Avatar who={p} size={20} /> <span>{p.displayName}</span> <small className="muted">{p.uniqueName}</small>
              </button>
            </li>
          ))}
        </ul>
      );
    },
  };
}
