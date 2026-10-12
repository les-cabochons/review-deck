export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Creates a logger that prefixes every line with a timestamp, level and `scope`. Lines below `minLevel` are dropped. */
export function createLogger(scope: string, minLevel: LogLevel = "info"): Logger {
  function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LEVELS[level] < LEVELS[minLevel]) return;
    const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${scope}: ${message}`;
    console.log(line, meta ?? "");
  }

  return {
    debug: (message, meta) => log("debug", message, meta),
    info: (message, meta) => log("info", message, meta),
    warn: (message, meta) => log("warn", message, meta),
    error: (message, meta) => log("error", message, meta),
  };
}
