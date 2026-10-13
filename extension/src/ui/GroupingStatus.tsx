import * as React from "react";
import type { AnalysisProgress } from "../review/engine";

/** "Building guided view… 42%" while the analysis worker runs. */
export const GroupingStatus: React.FC<{ progress: AnalysisProgress }> = ({ progress }) => (
  <span className="grouping-status" role="status" title={`${progress.label}…`}>
    <span className="spinner" aria-hidden="true" />
    Building guided view… {Math.round(progress.fraction * 100)}%
  </span>
);
