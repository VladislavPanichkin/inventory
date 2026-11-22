import { apiRequest, toQueryString } from "@/lib/api-client";
import type { Paginated, Sale, SaleStatus } from "@/lib/types";

export interface SaleListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: SaleStatus;
}

export const fetchSales = (params: SaleListParams) => apiRequest<Paginated<Sale>>(`/sales${toQueryString({ ...params })}`);
