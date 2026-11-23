import * as React from "react";

/**
 * A settings section whose settings couldn't be read: why, in place of the section, instead of its skeleton
 * waiting for good. A reload reads them again.
 */
export const LoadError: React.FC<{ message: string }> = ({ message }) => (
  <p className="settings-help tone-warning" role="alert">
    Couldn't load these settings: {message}. Reload the page to try again.
  </p>
);

/** For a section's load: logs the failure and keeps its message for LoadError. */
export function loadFailed(section: string, cancelled: () => boolean, setLoadError: (message: string) => void) {
  return (e: Error) => {
    console.warn(`[review-deck] could not load the ${section} settings:`, e);
    if (!cancelled()) setLoadError(e.message);
  };
}
