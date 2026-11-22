import { apiRequest } from "@/lib/api-client";

export interface HealthStatus {
  status: "ok" | "degraded";
  version: string;
  environment: string;
  timestamp: string;
  checks: {
    database: { status: "up" | "down"; latencyMs: number };
    ebayCredentials: { status: "configured" | "missing" };
  };
}

export async function fetchHealth(): Promise<HealthStatus> {
  const body = await apiRequest<{ data: HealthStatus }>("/health", { acceptStatuses: [503] });
  return body.data;
}
