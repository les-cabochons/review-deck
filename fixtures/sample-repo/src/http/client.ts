import type { HttpConfig } from "../config";
import { HttpError, TimeoutError } from "./errors";
import type { Fetcher, HttpResponse, QueryParams, RequestOptions } from "./types";

export function buildQueryString(query: QueryParams | undefined): string {
  if (!query) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

export class HttpClient {
  constructor(
    private readonly config: HttpConfig,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async get<T>(path: string, query?: QueryParams): Promise<HttpResponse<T>> {
    return this.request<T>(path, { method: "GET", query });
  }

  async post<T>(path: string, body: unknown): Promise<HttpResponse<T>> {
    return this.request<T>(path, { method: "POST", body });
  }

  async delete<T>(path: string): Promise<HttpResponse<T>> {
    return this.request<T>(path, { method: "DELETE" });
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<HttpResponse<T>> {
    const url = this.config.baseUrl + path + buildQueryString(options.query);
    console.log("http request", options.method ?? "GET", url);
    return this.send<T>(url, options);
  }

  private async send<T>(url: string, options: RequestOptions): Promise<HttpResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const res = await this.fetcher(url, {
        method: options.method ?? "GET",
        headers: { ...this.config.headers, ...options.headers },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      const data = (await res.json()) as T;
      if (!res.ok) {
        throw new HttpError(res.status, `Request failed with status ${res.status}`, data);
      }
      return { status: res.status, data, headers: Object.fromEntries(res.headers.entries()) };
    } catch (err) {
      if (controller.signal.aborted) throw new TimeoutError(url, this.config.timeoutMs);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
