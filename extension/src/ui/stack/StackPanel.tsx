import { Icon } from "azure-devops-ui/Icon";
import * as React from "react";
import type { PrSummary } from "../../data/list";
import { CHECKS, reviewState, STATE_ICON, stateKey } from "../prState";
import { cx, Time } from "../util";
import type { StackPosition } from "../../../../src/stack/stacks";
import { type StackView, withDetails } from "./useStack";

const RESTACK: Record<string, { icon: string; tone: string; label: string }> = {
  pending: { icon: "ProgressLoopOuter", tone: "info", label: "Restacking" },
  succeeded: { icon: "BranchRebase", tone: "success", label: "Restacked" },
  failed: { icon: "Warning", tone: "warning", label: "Needs a manual restack" },
};

/**
 * The stack in the Overview sidebar, Graphite-style: newest layer on top, the trunk (or the branch the
 * bottom layer targets) underneath, the current PR highlighted. Click a layer to open it.
 */
export const StackPanel: React.FC<{ view: StackView; onOpen: (pr: PrSummary) => void }> = ({ view, onOpen }) => {
  const { position } = view;
  const current = withDetails(view, position.pr);
  return (
    <section className="side-section stack-panel" aria-label="Stack">
      <h3>
        Stack
        <span className="count">{position.layers.length}</span>
        <span className="spacer" />
        <span className={cx("stack-mode", view.autoRestack && "on")} title={view.autoRestack ? "Layers are rebased automatically when the layer below changes or merges." : "A project administrator can turn on auto-restack in the PR hub sidebar."}>
          <Icon iconName="BranchRebase" /> Auto-restack {view.autoRestack ? "on" : "off"}
        </span>
      </h3>
      <StackLayers position={position} details={view.details} onOpen={onOpen} />
      {current.restack && <RestackNote restack={current.restack} />}
    </section>
  );
};

/**
 * A stack's layers, newest on top, with the base branch underneath and `position.pr` highlighted.
 * `openCurrent` keeps the highlighted layer clickable (in the hub, where it isn't the open page).
 */
export const StackLayers: React.FC<{
  position: StackPosition<PrSummary>;
  details: Map<number, Partial<PrSummary>>;
  onOpen: (pr: PrSummary) => void;
  openCurrent?: boolean;
}> = ({ position, details, onOpen, openCurrent }) => {
  const top = [...position.layers].reverse();
  const forks = position.children.filter((c) => !position.layers.includes(c));
  const withExtra = (pr: PrSummary) => ({ ...pr, ...details.get(pr.id) });
  return (
    <ol className="stack-layers">
      {top.map((layer) => (
        <React.Fragment key={layer.id}>
          {layer.id === position.pr.id && forks.map((fork) => <StackRow key={fork.id} pr={withExtra(fork)} fork onOpen={onOpen} />)}
          <StackRow pr={withExtra(layer)} current={layer.id === position.pr.id} openCurrent={openCurrent} onOpen={onOpen} />
        </React.Fragment>
      ))}
      <li className={cx("stack-base", !position.base.trunk && "orphan")}>
        <span className="node" aria-hidden="true">
          <Icon iconName={position.base.trunk ? "BranchCommit" : "Warning"} />
        </span>
        <span className="branch">{position.base.branch}</span>
        {!position.base.trunk && (
          <span className="muted">
            {" "}
            · no open PR. Its parent merged or was abandoned; auto-restack moves this layer when that PR completes, or retarget it.
          </span>
        )}
      </li>
    </ol>
  );
};

const StackRow: React.FC<{ pr: PrSummary; current?: boolean; openCurrent?: boolean; fork?: boolean; onOpen: (pr: PrSummary) => void }> = ({ pr, current, openCurrent, fork, onOpen }) => {
  const state = STATE_ICON[stateKey(pr)];
  const review = reviewState(pr);
  const checks = pr.checks ? CHECKS[pr.checks] : null;
  const restack = pr.restack ? RESTACK[pr.restack.state] : null;
  return (
    <li className={cx("stack-layer", current && "current", fork && "fork", `tone-${review.tone}`)}>
      <span className="node" aria-hidden="true" />
      <button
        className="stack-layer-link"
        disabled={(current && !openCurrent) || !pr.openable}
        aria-current={current ? (openCurrent ? "true" : "page") : undefined}
        title={`${pr.sourceBranch} → ${pr.targetBranch}${fork ? " (also stacked on this PR)" : ""}`}
        onClick={() => onOpen(pr)}
      >
        <span className="title">{pr.title}</span>
        <span className="meta muted">
          <span className={cx("pr-state-inline", state.className)} title={state.label}>
            <Icon iconName={state.icon} />
          </span>
          !{pr.id}
          {fork && <span className="fork-tag">fork</span>}
          <span className={cx("review", `tone-${review.tone}`)}>{review.label}</span>
        </span>
      </button>
      <span className="layer-icons">
        {restack && (
          <span className={`tone-${restack.tone}`} title={`${restack.label}: ${pr.restack!.description}`}>
            <Icon iconName={restack.icon} />
          </span>
        )}
        {checks && checks !== CHECKS.none && (
          <span className={`tone-${checks.tone}`} title={checks.label}>
            <Icon iconName={checks.icon} />
          </span>
        )}
      </span>
    </li>
  );
};

const RestackNote: React.FC<{ restack: NonNullable<PrSummary["restack"]> }> = ({ restack }) => {
  const info = RESTACK[restack.state];
  return (
    <p className={cx("stack-restack-note", `tone-${info.tone}`)} role="status">
      <Icon iconName={info.icon} /> {restack.description}{" "}
      <span className="muted">
        · <Time date={restack.date} />
      </span>
    </p>
  );
};

/** "Stack · 2 of 4 ‹ !17826 · !18665 ›" under the PR header, GitHub-style, on every tab. */
export const StackBar: React.FC<{ view: StackView; onOpen: (pr: PrSummary) => void }> = ({ view, onOpen }) => {
  const { position } = view;
  const index = position.layers.findIndex((l) => l.id === position.pr.id);
  const below = position.layers[index - 1];
  const above = position.layers[index + 1];
  const restack = withDetails(view, position.pr).restack;
  const info = restack && RESTACK[restack.state];
  const step = (pr: PrSummary | undefined, dir: "down" | "up") =>
    pr ? (
      <button className="stack-step" disabled={!pr.openable} onClick={() => onOpen(pr)} title={pr.title}>
        {dir === "down" && <Icon iconName="ChevronDown" />}!{pr.id}
        {dir === "up" && <Icon iconName="ChevronUp" />}
      </button>
    ) : null;
  return (
    <nav className="stack-bar" aria-label="Stack">
      <Icon iconName="BranchFork2" />
      <strong>Stack</strong>
      <span className="muted">
        {index + 1} of {position.layers.length} · on <span className="branch-inline">{position.pr.targetBranch}</span>
      </span>
      {step(below, "down")}
      {step(above, "up")}
      {info && (
        <span className={cx("stack-bar-restack", `tone-${info.tone}`)} title={restack!.description}>
          <Icon iconName={info.icon} /> {info.label}
        </span>
      )}
    </nav>
  );
};
