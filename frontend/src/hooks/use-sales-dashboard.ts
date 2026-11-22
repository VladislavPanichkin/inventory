import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchDashboardSummary } from "@/services/dashboard";
import { fetchSales, type SaleListParams } from "@/services/sales";

export function useSales(params: SaleListParams) {
  return useQuery({
    queryKey: ["sales", "list", params],
    queryFn: () => fetchSales(params),
    placeholderData: keepPreviousData,
  });
}

export function useDashboardSummary() {
  return useQuery({ queryKey: ["dashboard", "summary"], queryFn: fetchDashboardSummary });
}
