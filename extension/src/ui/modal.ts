import * as React from "react";

/** Focuses a modal while it's open, closes it on Escape, and gives focus back to whatever had it before. */
export function useModal(ref: React.RefObject<HTMLElement>, onClose: () => void): void {
  // Callers pass a new onClose each render; the effect must not re-run (and refocus) for that.
  const close = React.useRef(onClose);
  close.current = onClose;
  React.useEffect(() => {
    const restore = document.activeElement as HTMLElement | null;
    // A field that autofocused inside keeps focus.
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restore?.focus?.();
    };
  }, [ref]);
}
