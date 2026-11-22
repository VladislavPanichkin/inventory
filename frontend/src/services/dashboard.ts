import { apiRequest } from "@/lib/api-client";
import type { DashboardSummary } from "@/lib/types";

export const fetchDashboardSummary = async () =>
  (await apiRequest<{ data: DashboardSummary }>("/dashboard/summary")).data;
