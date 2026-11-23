import * as React from "react";

/** Whether the window matches a media query, kept current as the window resizes. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(() => window.matchMedia(query).matches);
  React.useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** A phone-width window, where the stylesheet's narrow layouts apply (its `max-width: 700px` rules). */
export const NARROW_SCREEN = "(max-width: 700px)";
