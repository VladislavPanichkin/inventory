import { AlertTriangle, ImagePlus, Star, Trash2 } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ProductThumbnail } from "@/components/product-thumbnail";
import { errorMessage } from "@/components/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useDeleteProductImage, useReorderProductImages, useUploadProductImages } from "@/hooks/use-product-images";
import { ebayImageSources } from "@/lib/ebay-image";
import { MAX_IMAGES_PER_PRODUCT, type Product } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Photo gallery and management for one product (details page): the selected photo shown
 * large in its original proportions, thumbnails to switch, and add / make main / delete.
 * The first photo is the main one (shown on the product card).
 */
export function ProductPhotos({ product }: { product: Pick<Product, "id" | "name" | "images" | "listing"> }) {
  const { images } = product;
  // Until the product has photos of its own, show eBay's picture of the listing (if any).
  const ebayPicture = images.length === 0 ? ebayImageSources(product.listing?.imageUrl, 1600) : null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const { upload, uploading, progress, clearProgress } = useUploadProductImages(product.id);
  const remove = useDeleteProductImage(product.id);
  const reorder = useReorderProductImages(product.id);

  const selected = images.find((image) => image.id === selectedId) ?? images[0] ?? null;
  const selectedIndex = selected ? images.indexOf(selected) : -1;
  const remaining = MAX_IMAGES_PER_PRODUCT - images.length;

  const onFilesChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = ""; // allow choosing the same file again later
    if (chosen.length === 0) return;
    const files = chosen.slice(0, remaining);
    if (files.length < chosen.length) {
      toast.warning(`Only ${files.length} more photo(s) fit: a product can have ${MAX_IMAGES_PER_PRODUCT}.`);
    }
    await upload(files);
  };

  const makeMain = () => {
    if (!selected) return;
    reorder.mutate([selected.id, ...images.filter((image) => image.id !== selected.id).map((image) => image.id)], {
      onSuccess: () => toast.success("Main photo updated"),
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  const deleteSelected = () => {
    if (!selected) return;
    remove.mutate(selected.id, {
      onSuccess: () => {
        toast.success("Photo deleted");
        setSelectedId(null);
        setDeleteOpen(false);
      },
      onError: (error) => {
        toast.error(errorMessage(error));
        setDeleteOpen(false);
      },
    });
  };

  const finished = progress !== null && !uploading;
  const added = progress ? progress.done - progress.failed.length : 0;

  return (
    <div className="flex flex-col gap-3">
      <ProductThumbnail
        key={selected?.id ?? "none"}
        src={selected?.url ?? ebayPicture?.src ?? null}
        fallbackSrc={ebayPicture?.fallbackSrc ?? null}
        alt={product.name}
        variant="natural"
      />
      {ebayPicture?.src && (
        <p className="text-sm text-muted-foreground">Picture from the eBay listing. Add your own photos to replace it.</p>
      )}

      {images.length > 1 && (
        <ul className="flex flex-wrap gap-2" aria-label="Photos">
          {images.map((image, index) => (
            <li key={image.id}>
              <button
                type="button"
                aria-label={`Photo ${index + 1}${index === 0 ? " (main)" : ""}`}
                aria-pressed={image.id === selected?.id}
                onClick={() => setSelectedId(image.id)}
                className={cn(
                  "relative block size-16 overflow-hidden rounded-md border-2 bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  image.id === selected?.id ? "border-primary" : "border-transparent",
                )}
              >
                <img src={image.thumbUrl} alt="" loading="lazy" className="size-full object-cover" />
                {index === 0 && (
                  <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[10px] leading-4 text-white">
                    Main
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          aria-label="Choose photos"
          tabIndex={-1}
          onChange={onFilesChosen}
        />
        <Button variant="outline" size="sm" disabled={uploading || remaining <= 0} onClick={() => fileInput.current?.click()}>
          <ImagePlus /> Add photos
        </Button>
        {selected && selectedIndex > 0 && (
          <Button variant="ghost" size="sm" disabled={reorder.isPending || uploading} onClick={makeMain}>
            <Star /> Make main
          </Button>
        )}
        {selected && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            disabled={remove.isPending || uploading}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 /> Delete photo
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {images.length} / {MAX_IMAGES_PER_PRODUCT} photos
        </span>
      </div>

      {uploading && progress && (
        <p role="status" className="text-sm text-muted-foreground">
          Uploading photo {Math.min(progress.done + 1, progress.total)} of {progress.total}…
        </p>
      )}

      {finished && progress.failed.length === 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          {added === 1 ? "1 photo added." : `${added} photos added.`}
        </p>
      )}

      {finished && progress.failed.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>
            {added > 0 ? `${added} added, ${progress.failed.length} could not be added` : "Photos could not be added"}
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {progress.failed.map((failure, index) => (
                <li key={`${failure.name}-${index}`}>
                  <span className="font-medium">{failure.name}:</span> {failure.message}
                </li>
              ))}
            </ul>
            <Button variant="outline" size="sm" onClick={clearProgress}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this photo?"
        description={
          selectedIndex === 0 && images.length > 1
            ? "This is the main photo. The next photo will become the main one. This cannot be undone."
            : "The photo is removed permanently. This cannot be undone."
        }
        confirmLabel="Delete photo"
        destructive
        pending={remove.isPending}
        onConfirm={deleteSelected}
      />
    </div>
  );
}
