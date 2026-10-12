import type { AppConfig } from "./index";

export const DEFAULT_CONFIG: AppConfig = {
  http: {
    baseUrl: "https://api.example.com",
    timeoutMs: 5000,
    retries: 3,
    retryDelayMs: 200,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  },
  cache: {
    ttlMs: 60_000,
    maxEntries: 500,
  },
  logLevel: "info",
};
