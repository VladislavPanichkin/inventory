import { Link } from "react-router";
import { ProductThumbnail } from "@/components/product-thumbnail";
import { ProductStatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { productCoverImage } from "@/lib/ebay-image";
import { formatMoney } from "@/lib/format";
import type { Product } from "@/lib/types";

/** Product tile for the products grid. The whole card links to the details page, where all actions live. */
export function ProductCard({ product }: { product: Pick<Product, "id" | "name" | "price" | "currency" | "status" | "images" | "listing"> }) {
  return (
    <Link
      to={`/products/${product.id}`}
      className="group flex w-full flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-colors hover:border-ring/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {/* Decorative inside the link: the name below already labels the card. */}
      <ProductThumbnail {...productCoverImage(product)} alt="" variant="cover" />
      <div className="flex flex-1 flex-col gap-2 p-3">
        <h2 className="line-clamp-2 text-sm font-medium leading-snug group-hover:underline">{product.name}</h2>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold tabular-nums">{formatMoney(product.price, product.currency)}</span>
          <ProductStatusBadge status={product.status} />
        </div>
      </div>
    </Link>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card" aria-hidden="true">
      <Skeleton className="aspect-square w-full rounded-none" />
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-5 w-1/2" />
      </div>
    </div>
  );
}
