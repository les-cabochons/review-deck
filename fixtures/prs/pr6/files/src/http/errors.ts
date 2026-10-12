export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
    /** X-Request-Id of the failed request, for correlating with server logs. */
    public readonly requestId?: string,
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
