import { Icon } from "azure-devops-ui/Icon";
import * as React from "react";
import { useModal } from "./modal";
import { cx } from "./util";

let dialogIds = 0;

/**
 * A dialog over a dimmed page, with a title bar and close button; Escape and the backdrop close it.
 * `placement: "bottom"` docks it to the bottom edge as a sheet, for phones.
 */
export const ModalDialog: React.FC<{
  title: string;
  icon: string;
  className?: string;
  placement?: "center" | "bottom";
  onClose: () => void;
}> = ({ title, icon, className, placement = "center", onClose, children }) => {
  const dialog = React.useRef<HTMLDivElement>(null);
  useModal(dialog, onClose);
  const titleId = React.useMemo(() => `modal-dialog-title-${++dialogIds}`, []);
  return (
    <div className={cx("modal-backdrop", placement === "bottom" && "bottom")} onClick={onClose}>
      <div
        ref={dialog}
        className={cx("modal", className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <Icon iconName={icon} />
          <h2 id={titleId}>{title}</h2>
          <span className="spacer" />
          <button className="modal-close" aria-label="Close" onClick={onClose}>
            <Icon iconName="Cancel" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
};
