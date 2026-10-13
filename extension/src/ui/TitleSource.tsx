import { Icon } from "azure-devops-ui/Icon";
import * as React from "react";
import type { Group, TitleSource } from "../../../src/core/types";

const LABEL: Record<TitleSource, string> = {
  llm: "Written by AI from the changes and the PR description",
  description: "Taken from the PR description",
  heuristic: "Generated from the code structure. A PR description that lists its steps, or AI titles, says more.",
};

/** Marks who wrote a group's title and summary; misc and mechanical groups have fixed labels, so they get none. */
export const TitleSourceIcon: React.FC<{ group: Group }> = ({ group }) => {
  const source = group.titleSource;
  if (!source || group.kind !== "semantic") return null;
  return (
    <span className={`title-source source-${source}`} title={LABEL[source]} aria-label={LABEL[source]} role="img">
      {source === "llm" ? <Sparkle /> : <Icon iconName={source === "description" ? "TextDocument" : "FlowChart"} />}
    </span>
  );
};

/** The usual "AI" mark; the icon font has none. */
const Sparkle: React.FC = () => (
  <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" fill="currentColor">
    <path d="M6.5 1.5 7.7 5a2 2 0 0 0 1.3 1.3l3.5 1.2-3.5 1.2A2 2 0 0 0 7.7 10l-1.2 3.5L5.3 10A2 2 0 0 0 4 8.7L.5 7.5 4 6.3A2 2 0 0 0 5.3 5Z" />
    <path d="M12.5 9.5l.6 1.6a1 1 0 0 0 .6.6l1.6.6-1.6.6a1 1 0 0 0-.6.6l-.6 1.6-.6-1.6a1 1 0 0 0-.6-.6l-1.6-.6 1.6-.6a1 1 0 0 0 .6-.6Z" />
  </svg>
);
