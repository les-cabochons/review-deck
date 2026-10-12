import type { HttpClient } from "../http/client";
import { HttpError } from "../http/errors";
import { buildQueryString } from "../utils/query";
import type { UserCache } from "./userCache";
import type { UserListResponse, UserRecord } from "./types";
import { type UserInput, validateUser } from "./validation";

export class UserService {
  constructor(
    private readonly http: HttpClient,
    private readonly cache: UserCache,
  ) {}

  async getUser(id: string): Promise<UserRecord | undefined> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    console.log("cache miss", id);
    try {
      const res = await this.http.get<UserRecord>(`/users/${id}`);
      this.cache.set(res.data);
      return res.data;
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return undefined;
      throw err;
    }
  }

  async listUsers(page = 1): Promise<UserListResponse> {
    const res = await this.http.get<UserListResponse>("/users", { page });
    for (const user of res.data.users) this.cache.set(user);
    return res.data;
  }

  async createUser(input: UserInput): Promise<UserRecord> {
    const errors = validateUser(input);
    if (errors.length > 0) {
      throw new Error(`Invalid user: ${errors.join(", ")}`);
    }
    const res = await this.http.post<UserRecord>("/users", input);
    this.cache.set(res.data);
    return res.data;
  }

  exportUrl(filters: { role?: string; since?: string }): string {
    return "/users/export" + buildQueryString(filters);
  }
}
