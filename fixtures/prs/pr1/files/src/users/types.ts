export type UserRole = "admin" | "member" | "guest";

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
}

export interface UserListResponse {
  users: User[];
  total: number;
  page: number;
}
