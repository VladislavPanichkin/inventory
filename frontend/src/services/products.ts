import { apiRequest, toQueryString } from "@/lib/api-client";
import type { Paginated, Product, ProductStatus, Sale, StatusChange } from "@/lib/types";

export type ProductSortField = "name" | "price" | "createdAt" | "updatedAt";

export interface ProductListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  /** Comma-separated statuses or "ALL"; omitted = everything except ARCHIVED. */
  status?: string;
  sort?: ProductSortField;
  order?: "asc" | "desc";
}

export interface ProductInput {
  name: string;
  description?: string | null;
  price: string;
  currency?: string;
  condition?: string | null;
}

export const fetchProducts = (params: ProductListParams) =>
  apiRequest<Paginated<Product>>(`/products${toQueryString({ ...params })}`);

export const fetchProduct = async (id: string) => (await apiRequest<{ data: Product }>(`/products/${id}`)).data;

export const createProduct = async (input: ProductInput) =>
  (await apiRequest<{ data: Product }>("/products", { method: "POST", body: input })).data;

export const updateProduct = async (id: string, input: Partial<ProductInput>) =>
  (await apiRequest<{ data: Product }>(`/products/${id}`, { method: "PATCH", body: input })).data;

export const changeProductStatus = async (id: string, status: ProductStatus, reason?: string) =>
  (
    await apiRequest<{ data: Product }>(`/products/${id}/status`, {
      method: "PATCH",
      body: { status, ...(reason ? { reason } : {}) },
    })
  ).data;

export const deleteProduct = (id: string) => apiRequest<void>(`/products/${id}`, { method: "DELETE" });

export const fetchStatusHistory = async (id: string) =>
  (await apiRequest<{ data: StatusChange[] }>(`/products/${id}/status-history`)).data;

export const fetchProductSales = async (id: string) =>
  (await apiRequest<{ data: Sale[] }>(`/products/${id}/sales`)).data;
