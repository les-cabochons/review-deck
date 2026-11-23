import * as React from "react";
import { createPortal } from "react-dom";

interface Props {
  /** The diagram's own size, in pixels at scale 1. */
  contentWidth: number;
  contentHeight: number;
  /** The canvas never grows past this height; the rest is reached by dragging. */
  maxHeight: number;
  label: string;
  children: React.ReactNode;
}

/** The diagram opens at its width's fit, but never smaller than this: below it the text can't be read. */
const MIN_FIT = 0.75;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;
const ZOOM_STEP = 1.2;
/** A press that moves less than this is a click on what is under it, not a drag. */
const DRAG_THRESHOLD = 4;
const KEY_PAN = 40;
/** Pixels of the diagram that always stay on the canvas, however far it is dragged. */
const KEEP_VISIBLE = 80;
/** Room the expanded view's title bar and margins take from the window's height. */
const EXPANDED_CHROME = 72;

interface View {
  x: number;
  y: number;
  scale: number;
}

interface Drag {
  pointer: number;
  startX: number;
  startY: number;
  from: View;
  moved: boolean;
}

/**
 * A diagram on a canvas the reader moves by dragging, like draw.io: press anywhere and drag. A press that doesn't
 * move clicks what is under it, so cards and connectors still work. Ctrl (or ⌘) and the wheel, or a trackpad pinch,
 * zoom around the pointer; the buttons zoom around the middle, and Fit puts it back. With the canvas focused, the
 * arrow keys move it and + and − zoom. The plain wheel still scrolls the page. Expand opens the canvas over the
 * whole page, fitted whole, for a diagram too big to explore in its place; Escape or Close puts it back.
 */
export const DiagramCanvas: React.FC<Props> = (props) => {
  const [expanded, setExpanded] = React.useState(false);
  const opener = React.useRef<HTMLButtonElement | null>(null);
  const close = React.useCallback(() => {
    setExpanded(false);
    // Back on the page, focus returns to the button that opened it.
    setTimeout(() => opener.current?.focus(), 0);
  }, []);
  if (!expanded) return <Canvas {...props} onExpand={() => setExpanded(true)} expandRef={opener} />;
  return (
    <>
      <div className="diagram-canvas-away" style={{ height: Math.min(props.contentHeight, props.maxHeight) }}>
        Shown over the page.{" "}
        <button type="button" className="link-button" onClick={close}>
          Put it back
        </button>
      </div>
      {createPortal(<Expanded {...props} onClose={close} />, document.body)}
    </>
  );
};

/** The canvas over the whole page, with a title bar. The page behind doesn't scroll while it is open. */
const Expanded: React.FC<Props & { onClose: () => void }> = ({ onClose, ...props }) => {
  const [room, setRoom] = React.useState(() => window.innerHeight - EXPANDED_CHROME);
  const closeButton = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    const resize = () => setRoom(window.innerHeight - EXPANDED_CHROME);
    window.addEventListener("resize", resize);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => {
      window.removeEventListener("resize", resize);
      document.body.style.overflow = overflow;
    };
  }, []);
  return (
    <div
      className="diagram-expanded"
      role="dialog"
      aria-modal="true"
      aria-label={props.label}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        } else if ((e.key === "Enter" || e.key === " ") && picks(e.target)) onClose();
      }}
      // A card or connector picked here acts on the page behind: the page comes back to show it.
      onClick={(e) => picks(e.target) && onClose()}
    >
      <div className="diagram-expanded-bar">
        <span>{props.label}</span>
        <button type="button" ref={closeButton} onClick={onClose}>
          Close
        </button>
      </div>
      <Canvas {...props} maxHeight={room} fill />
    </div>
  );
};

/** Whether `target` is in a card or connector that does something when picked. */
const picks = (target: EventTarget) => target instanceof Element && !!target.closest(".relation-node.selectable, .relation-edge.selectable");

interface CanvasProps extends Props {
  /** Shows the Expand button. */
  onExpand?: () => void;
  expandRef?: React.Ref<HTMLButtonElement>;
  /** Expanded: the canvas takes all of `maxHeight`, and Fit shows the whole diagram, however small. */
  fill?: boolean;
}

const Canvas: React.FC<CanvasProps> = ({ contentWidth, contentHeight, maxHeight, label, children, onExpand, expandRef, fill }) => {
  const [viewport, setViewport] = React.useState<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    if (!viewport) return;
    const measure = () => setWidth(viewport.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewport]);

  const fit = fill ? Math.max(MIN_ZOOM, Math.min(1, width / contentWidth, maxHeight / contentHeight)) : Math.max(MIN_FIT, Math.min(1, width / contentWidth));
  const height = fill ? maxHeight : Math.min(Math.ceil(contentHeight * fit), maxHeight);
  /** Null while the reader hasn't moved or zoomed it: the diagram sits fitted. */
  const [moved, setMoved] = React.useState<View | null>(null);
  // A new diagram, or a canvas resized, starts fitted again.
  React.useEffect(() => setMoved(null), [contentWidth, contentHeight, width]);
  // Fitted, it sits at the top left; expanded, in the middle of the page.
  const view = moved ?? (fill ? { x: Math.max(0, (width - contentWidth * fit) / 2), y: Math.max(0, (height - contentHeight * fit) / 2), scale: fit } : { x: 0, y: 0, scale: fit });
  const viewNow = React.useRef(view);
  viewNow.current = view;

  /**
   * Keeps some of the diagram on the canvas, like draw.io: it moves freely, but can't be dragged away out of sight.
   * KEEP_VISIBLE pixels of it, or all of it when smaller, stay on each axis.
   */
  const clamp = React.useCallback(
    (next: View): View => {
      const span = (size: number, room: number, at: number) => {
        const keep = Math.min(KEEP_VISIBLE, size * next.scale, room);
        return Math.min(Math.max(at, keep - size * next.scale), room - keep);
      };
      return { scale: next.scale, x: span(contentWidth, width, next.x), y: span(contentHeight, height, next.y) };
    },
    [contentWidth, contentHeight, width, height],
  );
  const zoomAt = React.useCallback(
    (factor: number, px: number, py: number) => {
      const from = viewNow.current;
      const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, from.scale * factor));
      // The point under the pointer stays under it.
      setMoved(clamp({ scale, x: px - ((px - from.x) * scale) / from.scale, y: py - ((py - from.y) * scale) / from.scale }));
    },
    [clamp],
  );

  // Ctrl or ⌘ and the wheel zoom. A listener of its own: React's is passive, so it couldn't stop the page zooming.
  React.useEffect(() => {
    if (!viewport) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const box = viewport.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY / 300), e.clientX - box.left, e.clientY - box.top);
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => viewport.removeEventListener("wheel", wheel);
  }, [viewport, zoomAt]);

  const drag = React.useRef<Drag | null>(null);
  const [dragging, setDragging] = React.useState(false);
  /** Set when a drag ends: the click the browser sends next belongs to the drag, not to what is under it. */
  const swallowClick = React.useRef(false);
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest(".diagram-canvas-controls")) return;
    drag.current = { pointer: e.pointerId, startX: e.clientX, startY: e.clientY, from: viewNow.current, moved: false };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      setDragging(true);
      // Only now: captured from the press, a click on a card would land on the canvas instead.
      viewport?.setPointerCapture(e.pointerId);
    }
    setMoved(clamp({ ...d.from, x: d.from.x + dx, y: d.from.y + dy }));
  };
  const up = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) return;
    setDragging(false);
    swallowClick.current = true;
    // A drag that ends outside the canvas gets no click: forget it after this event.
    setTimeout(() => (swallowClick.current = false), 0);
  };
  const click = (e: React.MouseEvent) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  const middle = () => [width / 2, height / 2] as const;
  const key = (e: React.KeyboardEvent) => {
    // Only the canvas itself: on a card, Enter and Space pick it, and the arrows are the browser's.
    if (e.target !== e.currentTarget) return;
    const pan = { ArrowLeft: [KEY_PAN, 0], ArrowRight: [-KEY_PAN, 0], ArrowUp: [0, KEY_PAN], ArrowDown: [0, -KEY_PAN] }[e.key];
    if (pan) setMoved(clamp({ ...viewNow.current, x: viewNow.current.x + pan[0], y: viewNow.current.y + pan[1] }));
    else if (e.key === "+" || e.key === "=") zoomAt(ZOOM_STEP, ...middle());
    else if (e.key === "-") zoomAt(1 / ZOOM_STEP, ...middle());
    else if (e.key === "0") setMoved(null);
    else return;
    e.preventDefault();
  };
  // Tabbing to a card the canvas has moved out of sight brings it back in.
  const focus = (e: React.FocusEvent) => {
    if (!viewport || e.target === viewport) return;
    const box = viewport.getBoundingClientRect();
    const target = (e.target as Element).getBoundingClientRect();
    const dx = target.left < box.left ? box.left - target.left + 12 : target.right > box.right ? box.right - target.right - 12 : 0;
    const dy = target.top < box.top ? box.top - target.top + 12 : target.bottom > box.bottom ? box.bottom - target.bottom - 12 : 0;
    if (dx || dy) setMoved(clamp({ ...viewNow.current, x: viewNow.current.x + dx, y: viewNow.current.y + dy }));
  };

  return (
    <div
      className={dragging ? "diagram-canvas dragging" : "diagram-canvas"}
      ref={setViewport}
      style={{ height }}
      tabIndex={0}
      role="group"
      aria-label={`${label}. Drag to move it. Ctrl and the mouse wheel zoom.`}
      title="Drag to move the diagram. Ctrl and the mouse wheel, or a pinch, zoom."
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onClickCapture={click}
      onKeyDown={key}
      onFocusCapture={focus}
    >
      <div
        className="diagram-canvas-content"
        style={{ width: contentWidth, height: contentHeight, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        {children}
      </div>
      <div className="diagram-canvas-controls">
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomAt(1 / ZOOM_STEP, ...middle())}>
          −
        </button>
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomAt(ZOOM_STEP, ...middle())}>
          +
        </button>
        <button type="button" title="Fit the diagram to the canvas, and put it back at the start" disabled={!moved} onClick={() => setMoved(null)}>
          Fit
        </button>
        {onExpand && (
          <button type="button" ref={expandRef} title="Show the diagram over the whole page" onClick={onExpand}>
            Expand
          </button>
        )}
      </div>
    </div>
  );
};
