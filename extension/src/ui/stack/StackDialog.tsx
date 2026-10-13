import { Icon } from "azure-devops-ui/Icon";
import * as React from "react";
import type { StackPosition } from "../../../../src/stack/stacks";
import type { PrSummary } from "../../data/list";
import { StackLayers } from "./StackPanel";

/** The whole stack in a modal, GitHub-style, from a hub row's stack chip. Pick any layer to open it. */
export const StackDialog: React.FC<{
  position: StackPosition<PrSummary>;
  details: Map<number, Partial<PrSummary>>;
  onOpen: (pr: PrSummary) => void;
  onClose: () => void;
}> = ({ position, details, onOpen, onClose }) => {
  const dialog = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const restore = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restore?.focus?.();
    };
  }, [onClose]);
  const index = position.layers.findIndex((l) => l.id === position.pr.id);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialog}
        className="modal stack-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stack-dialog-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <Icon iconName="BranchFork2" />
          <h2 id="stack-dialog-title">Stack</h2>
          <span className="muted">
            !{position.pr.id} is {index + 1} of {position.layers.length}
          </span>
          <span className="spacer" />
          <button className="modal-close" aria-label="Close" onClick={onClose}>
            <Icon iconName="Cancel" />
          </button>
        </header>
        <StackLayers position={position} details={details} onOpen={onOpen} openCurrent />
      </div>
    </div>
  );
};
