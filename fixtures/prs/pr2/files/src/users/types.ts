export type UserRole = "admin" | "member" | "guest";

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
}

export interface UserListResponse {
  users: UserRecord[];
  total: number;
  page: number;
}

export interface UserSearchOptions {
  role?: UserRole;
  limit?: number;
}
