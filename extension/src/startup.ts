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
