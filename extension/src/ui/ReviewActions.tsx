import * as React from "react";
import type { Identity, PrActions, PrOverview, PrSource } from "../data/model";

interface ReviewActions {
  actions: PrActions;
  currentUser: Identity;
  disabled: boolean;
  /** The last failed write or refresh, until the next one starts. */
  error: string | null;
  run: (write: () => Promise<void>) => Promise<boolean>;
  /** Re-reads the PR without showing the saving state, to follow work Azure DevOps does in the background. */
  poll: () => Promise<void>;
}

const Context = React.createContext<ReviewActions | null>(null);
export function useReviewActions(): ReviewActions {
  const value = React.useContext(Context);
  if (!value) throw new Error("Review controls need a ReviewActionsProvider.");
  return value;
}

export const ReviewActionsProvider: React.FC<{
  source: PrSource;
  onData: (data: PrOverview) => void;
  /** The page shows a copy kept from an earlier visit until the PR loads: changes wait for it. */
  stale?: boolean;
}> = ({ source, onData, stale = false, children }) => {
  const inFlight = React.useRef(false);
  const [pending, setPending] = React.useState(false);
  const [needsRefresh, setNeedsRefresh] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      onData(await source.load());
      setNeedsRefresh(false);
      setError(null);
    } catch (e) {
      setError(`Could not refresh: ${message(e)}`);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const run = async (write: () => Promise<void>) => {
    if (inFlight.current || needsRefresh || stale) return false;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await write();
    } catch (e) {
      setError(`Could not save: ${message(e)}`);
      inFlight.current = false;
      setPending(false);
      return false;
    }
    try {
      onData(await source.load());
    } catch (e) {
      setNeedsRefresh(true);
      setError(`Saved, but the page could not refresh: ${message(e)}. Refresh before making another change.`);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
    return true; // The write succeeded even if reloading failed. Do not repost the draft.
  };

  const poll = async () => {
    if (inFlight.current) return;
    try {
      onData(await source.load());
    } catch {
      // The next poll tries again.
    }
  };

  return (
    <Context.Provider value={{ actions: source.actions, currentUser: source.currentUser, disabled: pending || needsRefresh || stale, error, run, poll }}>
      <div className="write-feedback" aria-live="polite">
        {pending && <span role="status">Saving and refreshing…</span>}
        {error && (
          <div className="write-error" role="alert">
            {error}{" "}
            <button className="link-button" disabled={pending} onClick={refresh}>
              Refresh pull request
            </button>
          </div>
        )}
      </div>
      {children}
    </Context.Provider>
  );
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
