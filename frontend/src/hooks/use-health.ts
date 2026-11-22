import { useQuery } from "@tanstack/react-query";
import { fetchHealth } from "@/services/health";

export const healthQueryKey = ["health"] as const;

/** Backend/database status, checked on app start and on manual refresh (no polling). */
export function useHealth() {
  return useQuery({ queryKey: healthQueryKey, queryFn: fetchHealth });
}
