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

/** Every hosted startup must finish the host's loading state, including failures. */
export async function startHostedPage(host: Host, render: () => Promise<void>, showError: (error: Error) => void) {
  try {
    await withTimeout(host.init({ loaded: false, applyTheme: true }), "Azure DevOps did not respond during startup. Reload to try again.");
    await render();
    await withTimeout(host.notifyLoadSucceeded(), "Azure DevOps did not acknowledge the review page.");
  } catch (cause) {
    const message = cause && typeof cause === "object" && "message" in cause ? String(cause.message) : String(cause);
    const error = cause instanceof Error ? cause : new Error(message);
    showError(error);
    // Reporting can also fail when the host connection itself is unavailable.
    void host.notifyLoadFailed(error).catch(() => {});
  }
}
