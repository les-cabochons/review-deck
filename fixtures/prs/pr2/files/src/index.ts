import { loadConfig } from "./config";
import { HttpClient } from "./http/client";
import { UserCache } from "./users/userCache";
import { UserService } from "./users/userService";
import { createLogger } from "./utils/logger";

export function createApp(env: Record<string, string | undefined> = process.env) {
  const config = loadConfig(env);
  createLogger("app", config.logLevel).info("starting app", { baseUrl: config.http.baseUrl });
  const http = new HttpClient(config.http);
  const cache = new UserCache(config.cache);
  const users = new UserService(http, cache);
  return { config, http, users };
}

export * from "./users/types";
export { HttpError, TimeoutError } from "./http/errors";
