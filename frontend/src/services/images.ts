import { apiRequest } from "@/lib/api-client";
import type { PreparedImage } from "@/lib/image-resize";
import type { ProductImage } from "@/lib/types";

export async function uploadProductImage(productId: string, image: PreparedImage): Promise<ProductImage> {
  const formData = new FormData();
  formData.append("image", image.full, "photo.jpg");
  formData.append("thumbnail", image.thumbnail, "thumbnail.jpg");
  return (await apiRequest<{ data: ProductImage }>(`/products/${productId}/images`, { method: "POST", formData })).data;
}

export const deleteProductImage = (productId: string, imageId: string) =>
  apiRequest<void>(`/products/${productId}/images/${imageId}`, { method: "DELETE" });

/** Sets the photo order; the first ID becomes the main photo. */
export const reorderProductImages = async (productId: string, imageIds: string[]) =>
  (await apiRequest<{ data: ProductImage[] }>(`/products/${productId}/images/order`, { method: "PUT", body: { imageIds } })).data;
