import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProductStatus } from "@/lib/types";
import {
  changeProductStatus,
  createProduct,
  deleteProduct,
  fetchProduct,
  fetchProductSales,
  fetchProducts,
  fetchStatusHistory,
  updateProduct,
  type ProductInput,
  type ProductListParams,
} from "@/services/products";

export const productKeys = {
  all: ["products"] as const,
  list: (params: ProductListParams) => ["products", "list", params] as const,
  detail: (id: string) => ["products", "detail", id] as const,
  history: (id: string) => ["products", "detail", id, "history"] as const,
  sales: (id: string) => ["products", "detail", id, "sales"] as const,
};

export function useProducts(params: ProductListParams) {
  return useQuery({
    queryKey: productKeys.list(params),
    queryFn: () => fetchProducts(params),
    placeholderData: keepPreviousData, // keep the grid visible while paging/filtering
  });
}

export function useProduct(id: string) {
  return useQuery({ queryKey: productKeys.detail(id), queryFn: () => fetchProduct(id) });
}

export function useStatusHistory(id: string) {
  return useQuery({ queryKey: productKeys.history(id), queryFn: () => fetchStatusHistory(id) });
}

export function useProductSales(id: string) {
  return useQuery({ queryKey: productKeys.sales(id), queryFn: () => fetchProductSales(id) });
}

/** Product changes affect lists, details and dashboard counts. */
function useInvalidateInventory() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: productKeys.all }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
}

export function useCreateProduct() {
  const invalidate = useInvalidateInventory();
  return useMutation({ mutationFn: (input: ProductInput) => createProduct(input), onSuccess: invalidate });
}

export function useUpdateProduct(id: string) {
  const invalidate = useInvalidateInventory();
  return useMutation({ mutationFn: (input: Partial<ProductInput>) => updateProduct(id, input), onSuccess: invalidate });
}

export function useChangeProductStatus() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: ProductStatus; reason?: string }) =>
      changeProductStatus(id, status, reason),
    onSuccess: invalidate,
  });
}

export function useDeleteProduct() {
  const invalidate = useInvalidateInventory();
  return useMutation({ mutationFn: (id: string) => deleteProduct(id), onSuccess: invalidate });
}
