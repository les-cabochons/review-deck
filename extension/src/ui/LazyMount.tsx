import * as React from "react";

/**
 * Renders children only while they are near the viewport, so a PR with thousands of hunks keeps a
 * small DOM. Off-screen content is a placeholder of the last measured (or estimated) height.
 *
 * Content mounts within `MOUNT_MARGIN` of the viewport and unmounts beyond `UNMOUNT_MARGIN`
 * (two thresholds, so scrolling back and forth doesn't thrash). It never unmounts while it holds
 * focus or a non-empty text box, so scrolling away cannot lose a half-written comment.
 */
const MOUNT_MARGIN = 1500;
const UNMOUNT_MARGIN = 5000;

/** Scroll container to observe against; null means the page viewport. */
export const LazyRoot = React.createContext<Element | null>(null);

type Listener = (near: boolean) => void;
type Observers = Map<number, { io: IntersectionObserver; listeners: Map<Element, Listener> }>;
const viewportObservers: Observers = new Map();
const rootObservers = new WeakMap<Element, Observers>();

/** Shares one IntersectionObserver per (root, margin) across all lazily mounted elements. */
function observe(root: Element | null, margin: number, el: Element, listener: Listener): () => void {
  let table = root ? rootObservers.get(root) : viewportObservers;
  if (!table) rootObservers.set(root!, (table = new Map()));
  let entry = table.get(margin);
  if (!entry) {
    const listeners = new Map<Element, Listener>();
    const io = new IntersectionObserver(
      (records) => {
        for (const r of records) listeners.get(r.target)?.(r.isIntersecting);
      },
      // An explicit document root: inside Azure DevOps' cross-origin iframe the implicit root is the
      // top window, where browsers ignore rootMargin, so content would only mount once on screen.
      { root: root ?? document, rootMargin: `${margin}px 0px` },
    );
    entry = { io, listeners };
    table.set(margin, entry);
  }
  entry.listeners.set(el, listener);
  entry.io.observe(el);
  const current = entry;
  return () => {
    current.listeners.delete(el);
    current.io.unobserve(el);
  };
}

function holdsInput(el: HTMLElement): boolean {
  if (el.contains(document.activeElement)) return true;
  return [...el.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>("textarea, input[type=text]")].some((t) => t.value.trim() !== "");
}

export const LazyMount: React.FC<{ estimate: number; className?: string; children: React.ReactNode }> = ({ estimate, className, children }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const root = React.useContext(LazyRoot);
  const [mounted, setMounted] = React.useState(false);
  const height = React.useRef<number | null>(null);
  // A new estimate means the content changed size while away (a file folded off-screen), so the
  // last measurement is stale.
  const estimated = React.useRef(estimate);
  if (estimated.current !== estimate) {
    estimated.current = estimate;
    height.current = null;
  }

  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setMounted(true);
      return;
    }
    const stopNear = observe(root, MOUNT_MARGIN, el, (near) => near && setMounted(true));
    const stopFar = observe(root, UNMOUNT_MARGIN, el, (inRange) => {
      if (inRange || holdsInput(el)) return;
      height.current = el.offsetHeight || height.current;
      setMounted(false);
    });
    return () => {
      stopNear();
      stopFar();
    };
  }, [root]);

  return (
    <div ref={ref} className={className} style={mounted ? undefined : { height: height.current ?? estimate }}>
      {mounted ? children : null}
    </div>
  );
};
