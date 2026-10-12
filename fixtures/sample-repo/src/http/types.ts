export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  method?: HttpMethod;
  query?: QueryParams;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface HttpResponse<T> {
  status: number;
  data: T;
  headers: Record<string, string>;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
