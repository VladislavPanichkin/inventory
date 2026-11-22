import { ApiError, apiRequest } from "@/lib/api-client";
import type { Admin } from "@/lib/types";

/** Returns the current admin, or null when not logged in. */
export async function fetchMe(): Promise<Admin | null> {
  try {
    return (await apiRequest<{ data: Admin }>("/auth/me")).data;
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthorized) return null;
    throw error;
  }
}

export async function login(credentials: { email: string; password: string }): Promise<Admin> {
  return (await apiRequest<{ data: Admin }>("/auth/login", { method: "POST", body: credentials })).data;
}

export async function logout(): Promise<void> {
  await apiRequest<void>("/auth/logout", { method: "POST" });
}
