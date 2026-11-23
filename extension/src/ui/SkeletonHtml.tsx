import * as React from "react";

/**
 * Skeleton markup from src/skeletons.ts, as a React loading state. Its element has no box of its own
 * (`display: contents`), so the markup lays out exactly as in the static page that showed it before React.
 */
export const SkeletonHtml: React.FC<{ html: string }> = ({ html }) => <span className="skeleton-contents" dangerouslySetInnerHTML={{ __html: html }} />;
