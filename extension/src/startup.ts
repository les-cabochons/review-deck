import { THEME_KEY } from "./skeletons";

interface Host {
  init(options: { loaded: boolean; applyTheme: boolean }): Promise<void>;
  notifyLoadSucceeded(): Promise<void>;
  notifyLoadFailed(error: Error): Promise<void>;
}

export async function withTimeout<T>(work: Promise<T>, message: string, milliseconds = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Keeps the host's theme (the CSS variables SDK.init applies during the handshake) in this browser, so the next
 * load's static page paints its skeleton in those colors before the handshake instead of flashing the light
 * defaults (static/review.html, src/skeletons.ts themeBootScript). Call before starting the handshake.
 */
export function rememberHostTheme(storage: () => Pick<Storage, "setItem"> = () => window.localStorage, target: EventTarget = window): void {
  target.addEventListener("themeApplied", (event) => {
    const theme = (event as CustomEvent<unknown>).detail;
    if (!theme || typeof theme !== "object") return;
    try {
      storage().setItem(THEME_KEY, JSON.stringify(theme));
    } catch {
      // Denied or full storage: the next load starts with the light defaults, as before.
    }
  });
}

/**
 * Every hosted startup must finish the host's loading state, including failures. The static page already shows
 * a skeleton, so the host's own loading indicator ends right after the handshake; the page then fills in behind
 * it, and anything that fails from there on is shown on the page itself (with a reload button).
 */
export async function startHostedPage(host: Host, render: () => Promise<void>, showError: (error: Error) => void, timeout = 15_000) {
  try {
    await withTimeout(host.init({ loaded: false, applyTheme: true }), "Azure DevOps did not respond during startup. Reload to try again.", timeout);
  } catch (cause) {
    const error = toError(cause);
    showError(error);
    // Reporting can also fail when the host connection itself is unavailable.
    void host.notifyLoadFailed(error).catch(() => {});
    return;
  }
  const revealed = withTimeout(host.notifyLoadSucceeded(), "Azure DevOps did not acknowledge the review page.", timeout).catch((cause: unknown) => {
    const error = toError(cause);
    showError(error);
    void host.notifyLoadFailed(error).catch(() => {});
  });
  try {
    await render();
  } catch (cause) {
    showError(toError(cause));
  }
  await revealed;
}

function toError(cause: unknown): Error {
  if (cause instanceof Error) return cause;
  const message = cause && typeof cause === "object" && "message" in cause ? String(cause.message) : String(cause);
  return new Error(message);
}

type FlagStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Opens a hub an organization can turn off without waiting to learn whether it did: that setting is a REST round
 * trip, often the slowest step of startup, and the hub's cached rows would wait behind it. The page renders at
 * once and gives way to `showOff` if the check says the feature is off (null means on). Only where it was off last
 * time in this browser (remembered under `key`) does the page wait for the check, so a turned-off hub doesn't
 * flash its content.
 */
export async function renderUnlessOff<T>(
  off: Promise<T | null>,
  key: string,
  render: () => Promise<void> | void,
  showOff: (reason: T) => void,
  storage: () => FlagStorage = () => window.localStorage,
): Promise<void> {
  const remembered = off.then((reason) => {
    try {
      if (reason === null) storage().removeItem(key);
      else storage().setItem(key, "off");
    } catch {
      // Denied storage: the next load renders at once and checks, as it does the first time.
    }
    return reason;
  });
  let wasOff = false;
  try {
    wasOff = storage().getItem(key) === "off";
  } catch {
    // As above.
  }
  if (wasOff) {
    const reason = await remembered;
    if (reason === null) await render();
    else showOff(reason);
    return;
  }
  await render();
  const reason = await remembered;
  if (reason !== null) showOff(reason);
}
