import * as React from "react";

/**
 * Makes refreshed data easy to follow without moving anything on screen: when `revision` changes (new list,
 * details or teams, not a filter or a collapse), rows that now sit in a different section flash briefly in place.
 * While not `enabled`, it only records where rows are.
 * Rows carry `data-pr` and `data-section`.
 */
export function useSectionFlash(container: React.RefObject<HTMLElement>, revision: number, enabled: boolean): void {
  const last = React.useRef<{ revision: number; sections: Map<string, string> }>({ revision, sections: new Map() });
  React.useLayoutEffect(() => {
    const root = container.current;
    // Hidden behind a PR page: keep the last visible placement to compare against on the way back.
    if (!root || root.getClientRects().length === 0) return;
    const now = new Map<string, { el: HTMLElement; section: string }>();
    for (const el of root.querySelectorAll<HTMLElement>("[data-pr]")) now.set(el.dataset.pr!, { el, section: el.dataset.section ?? "" });
    const before = last.current;
    last.current = { revision, sections: new Map([...now].map(([id, row]) => [id, row.section])) };
    if (!enabled || before.revision === revision || before.sections.size === 0) return;
    for (const [id, row] of now) {
      const was = before.sections.get(id);
      if (was !== undefined && was !== row.section) flash(row.el);
    }
  });
}

/** An attribute, not a class: React rewrites className on hover and selection, which would cut the flash short. */
function flash(el: HTMLElement): void {
  el.removeAttribute("data-moved");
  void el.offsetWidth; // restart the animation
  el.setAttribute("data-moved", "");
  el.addEventListener("animationend", () => el.removeAttribute("data-moved"), { once: true });
}
