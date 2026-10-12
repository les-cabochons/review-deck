import { DEFAULT_CONFIG } from "./defaults";

export interface HttpConfig {
  baseUrl: string;
  timeoutMs: number;
  headers: Record<string, string>;
}

export interface CacheConfig {
  ttlMs: number;
  maxEntries: number;
}

export type LogLevelName = "debug" | "info" | "warn" | "error";

export interface AppConfig {
  http: HttpConfig;
  cache: CacheConfig;
  logLevel: LogLevelName;
}

type Env = Record<string, string | undefined>;

/**
 * Builds the app config from environment variables, falling back to DEFAULT_CONFIG
 * for anything unset or unparsable.
 */
export function loadConfig(env: Env = process.env): AppConfig {
  return {
    http: {
      ...DEFAULT_CONFIG.http,
      baseUrl: env.API_BASE_URL ?? DEFAULT_CONFIG.http.baseUrl,
      timeoutMs: parseIntOr(env.API_TIMEOUT_MS, DEFAULT_CONFIG.http.timeoutMs),
    },
    cache: {
      ttlMs: parseIntOr(env.CACHE_TTL_MS, DEFAULT_CONFIG.cache.ttlMs),
      maxEntries: parseIntOr(env.CACHE_MAX_ENTRIES, DEFAULT_CONFIG.cache.maxEntries),
    },
    logLevel: (env.LOG_LEVEL as LogLevelName | undefined) ?? DEFAULT_CONFIG.logLevel,
  };
}

function parseIntOr(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}
