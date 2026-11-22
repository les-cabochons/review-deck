import * as React from "react";
import { isInfrastructure, needsLook, riskRank } from "../../../../src/infra/blocks";
import type { InfraBlock, InfraModule } from "../../../../src/infra/types";
import { cx } from "../util";

export type Tone = "destroy" | "replace" | "follows" | "changed" | "added" | "removed" | "docs" | "same";

/**
 * How the page names what happens to a block. A destroy or a replace is never stated as a fact: the label carries
 * how sure the reading is ("likely", "possible", "may"), and `symbol` is what `terraform plan` would print for it.
 */
export function verdict(block: InfraBlock): { tone: Tone; symbol: string; label: string } {
  const { risk } = block;
  if (risk?.kind === "destroy") return { tone: "destroy", symbol: "−", label: `destroy ${risk.certainty}` };
  if (risk?.kind === "replace") return { tone: "replace", symbol: "−/+", label: `replace ${risk.certainty}` };
  if (risk?.kind === "follows") return { tone: "follows", symbol: "−/+?", label: "may follow" };
  if (block.docsOnly) return { tone: "docs", symbol: "", label: "description only" };
  if (block.status === "changed") return { tone: "changed", symbol: "~", label: "changed" };
  if (block.status === "added") return { tone: "added", symbol: "+", label: "added" };
  if (block.status === "removed") return { tone: "removed", symbol: "−", label: "removed from the code" };
  return { tone: "same", symbol: "", label: "unchanged" };
}

export const Verdict: React.FC<{ block: InfraBlock }> = ({ block }) => {
  const { tone, label } = verdict(block);
  return <span className={cx("infra-badge", `tone-${tone}`)}>{label}</span>;
};

/** Where a destroy or replace reading comes from. Today always the code; a plan published by a pipeline would say so here. */
export const FromCode: React.FC = () => (
  <span className="infra-badge source" title="Read from the changed .tf files. No terraform plan is attached, so this is a reading of the code, not what the provider will do.">
    from code
  </span>
);

/** "1 destroy likely · 2 replace possible · 3 changed": the resources, data sources and modules worth a look, worst first. */
export const SummaryBadges: React.FC<{ modules: InfraModule[] }> = ({ modules }) => {
  const blocks = modules
    .flatMap((m) => m.blocks)
    .filter((b) => isInfrastructure(b) && needsLook(b))
    .sort((a, b) => riskRank(a) - riskRank(b));
  const counts = new Map<string, { block: InfraBlock; count: number }>();
  for (const block of blocks) {
    const { label } = verdict(block);
    const entry = counts.get(label);
    if (entry) entry.count++;
    else counts.set(label, { block, count: 1 });
  }
  if (counts.size === 0) return <span className="muted">No resource changes</span>;
  return (
    <span className="infra-summary">
      {[...counts].map(([label, { block, count }]) => (
        <span key={label} className={cx("infra-badge", `tone-${verdict(block).tone}`)}>
          {count} {label}
        </span>
      ))}
    </span>
  );
};

/** Text with `code` spans: the reasons and notes of src/infra quote attributes and addresses in backticks. */
export const Quoted: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split("`").map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}
  </>
);
