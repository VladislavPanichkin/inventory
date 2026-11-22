import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { productKeys } from "@/hooks/use-products";
import { ApiError } from "@/lib/api-client";
import { prepareImage } from "@/lib/image-resize";
import { deleteProductImage, reorderProductImages, uploadProductImage } from "@/services/images";

export interface UploadProgress {
  total: number;
  done: number;
  /** Files that could not be added, with the reason. */
  failed: { name: string; message: string }[];
}

function failureMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Could not upload this photo.";
}

/**
 * Uploads photos one after another (resizing each on the device first), so progress is
 * visible and one bad file doesn't stop the rest. The product is reloaded when finished.
 */
export function useUploadProductImages(productId: string) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [uploading, setUploading] = useState(false);

  const upload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      const state: UploadProgress = { total: files.length, done: 0, failed: [] };
      setProgress({ ...state });
      try {
        for (const file of files) {
          try {
            await uploadProductImage(productId, await prepareImage(file));
          } catch (error) {
            state.failed = [...state.failed, { name: file.name, message: failureMessage(error) }];
          }
          state.done += 1;
          setProgress({ ...state });
        }
      } finally {
        setUploading(false);
        await queryClient.invalidateQueries({ queryKey: productKeys.all });
      }
    },
    [productId, queryClient],
  );

  return { upload, uploading, progress, clearProgress: () => setProgress(null) };
}

export function useDeleteProductImage(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (imageId: string) => deleteProductImage(productId, imageId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productKeys.all }),
  });
}

export function useReorderProductImages(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (imageIds: string[]) => reorderProductImages(productId, imageIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productKeys.all }),
  });
}
