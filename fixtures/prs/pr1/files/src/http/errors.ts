export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }

  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

export class TimeoutError extends Error {
  constructor(
    public readonly url: string,
    public readonly timeoutMs: number,
  ) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

/** Timeouts, 429s and 5xx responses are worth retrying; other errors are not. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  return err instanceof HttpError && (err.status === 429 || err.status >= 500);
}
