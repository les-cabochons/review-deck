import { loadConfig } from "./config";
import { HttpClient } from "./http/client";
import { UserCache } from "./users/userCache";
import { UserService } from "./users/userService";

export function createApp(env: Record<string, string | undefined> = process.env) {
  const config = loadConfig(env);
  console.log("starting app with config", config);
  const http = new HttpClient(config.http);
  const cache = new UserCache(config.cache);
  const users = new UserService(http, cache);
  return { config, http, users, cacheStats: () => cache.stats() };
}

export * from "./users/types";
export { HttpError, TimeoutError } from "./http/errors";
