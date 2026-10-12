import { Button } from "azure-devops-ui/Button";
import * as React from "react";
import { MarkdownEditor, type MarkdownEditorHandle } from "./editor/MarkdownEditor";
import { useReviewActions } from "./ReviewActions";
import { cx } from "./util";

export interface ComposerAction {
  text: string;
  onSave: (text: string) => Promise<void> | void;
  /**
   * Server writes (the default) go through the serialized write queue and keep the draft on failure.
   * Local actions, such as adding to a pending review, run immediately.
   */
  local?: boolean;
}

/**
 * Comment box: markdown editor plus action buttons (the first is primary).
 * Pass `actions` for multiple choices ("Add review comment" / "Comment now"), or `onSave` + `submitText`.
 */
export const CommentComposer: React.FC<{
  label: string;
  actions?: ComposerAction[];
  submitText?: string;
  onSave?: (text: string) => Promise<void>;
  initial?: string;
  allowEmpty?: boolean;
  placeholder?: string;
  onCancel?: () => void;
  onSaved?: () => void;
  autoFocus?: boolean;
  className?: string;
}> = ({ label, actions, submitText = "Comment", onSave, initial = "", allowEmpty, placeholder, onCancel, onSaved, autoFocus, className }) => {
  const { disabled, run } = useReviewActions();
  const [text, setText] = React.useState(initial);
  const editor = React.useRef<MarkdownEditorHandle>(null);
  const choices: ComposerAction[] = actions ?? (onSave ? [{ text: submitText, onSave }] : []);
  const unchanged = allowEmpty ? text === initial : !text.trim();
  const blocked = disabled || unchanged;

  const submit = async (action: ComposerAction) => {
    if (blocked) return;
    if (action.local) {
      await action.onSave(text);
    } else if (!(await run(() => Promise.resolve(action.onSave(text))))) {
      return; // keep the draft so nothing is lost
    }
    setText("");
    onSaved?.();
  };

  return (
    <form
      className={cx("comment-composer", className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (choices[0]) void submit(choices[0]);
      }}
    >
      <MarkdownEditor
        ref={editor}
        label={label}
        value={text}
        onChange={setText}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus ?? !!onCancel}
        onSubmit={() => choices[0] && void submit(choices[0])}
        onCancel={onCancel}
      />
      <div className="editor-actions">
        <span className="muted editor-hint">Ctrl+Enter to submit</span>
        {onCancel && <Button text="Cancel" subtle disabled={disabled} onClick={onCancel} />}
        {choices
          .slice(1)
          .reverse()
          .map((a) => (
            <Button key={a.text} text={a.text} disabled={blocked} onClick={() => void submit(a)} />
          ))}
        {choices[0] && <Button text={choices[0].text} primary disabled={blocked} type="submit" />}
      </div>
    </form>
  );
};
