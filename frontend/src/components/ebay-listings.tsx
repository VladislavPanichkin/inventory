import { Check, ExternalLink, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ProductThumbnail } from "@/components/product-thumbnail";
import { EmptyState, ErrorState, LoadingRows, errorMessage } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useEbayListings, useImportEbayListings } from "@/hooks/use-ebay";
import { formatMoney } from "@/lib/format";
import type { EbayActiveListing, EbayImportResult } from "@/lib/types";

function importSummary(result: EbayImportResult): string {
  const added = result.created.length;
  const noPrice = result.skipped.filter((entry) => entry.reason === "NO_PRICE").length;
  const gone = result.skipped.filter((entry) => entry.reason === "NOT_ACTIVE").length;
  const parts = [added === 1 ? "1 product added" : `${added} products added`];
  if (noPrice > 0) parts.push(`${noPrice} skipped (no price on eBay)`);
  if (gone > 0) parts.push(`${gone} no longer active on eBay`);
  return parts.join(", ");
}

function ListingRow({
  listing,
  onAdd,
  adding,
  disabled,
}: {
  listing: EbayActiveListing;
  onAdd: () => void;
  adding: boolean;
  disabled: boolean;
}) {
  const title = listing.title ?? `eBay item ${listing.itemId}`;
  return (
    <li className="flex items-center gap-3 py-3">
      <ProductThumbnail src={listing.imageUrl} alt="" className="size-14" />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium leading-snug">{title}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">
            {listing.price ? formatMoney(listing.price, listing.currency ?? "EUR") : "No price"}
          </span>
          {listing.quantityAvailable !== null && listing.quantityAvailable > 1 && (
            <Badge variant="outline">{listing.quantityAvailable} available</Badge>
          )}
          {listing.listingUrl ? (
            <a
              href={listing.listingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-xs underline-offset-4 hover:underline"
              aria-label={`Open “${title}” on eBay`}
            >
              {listing.itemId}
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          ) : (
            <span className="font-mono text-xs">{listing.itemId}</span>
          )}
        </p>
      </div>
      {listing.productId ? (
        <Button asChild variant="ghost" size="sm">
          <Link to={`/products/${listing.productId}`} aria-label={`“${title}” is in the inventory. Open product`}>
            {/* Phones show just the tick, to leave the width to the title. */}
            <Check /> <span className="hidden sm:inline">In inventory</span>
          </Link>
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={onAdd}
          disabled={disabled || !listing.price}
          aria-label={`Add “${title}” to inventory`}
        >
          <Plus /> {adding ? "Adding…" : "Add"}
        </Button>
      )}
    </li>
  );
}

/**
 * The seller's active eBay listings with the option to create inventory products from them.
 * Reads from eBay only: nothing here changes a listing.
 */
export function EbayListings({ simulated = false }: { simulated?: boolean }) {
  const listings = useEbayListings(true);
  const importListings = useImportEbayListings();
  const [addingId, setAddingId] = useState<string | "all" | null>(null);

  const run = (target: string | "all") => {
    setAddingId(target);
    importListings.mutate(target === "all" ? undefined : [target], {
      onSuccess: (result) => {
        if (result.created.length > 0) toast.success(importSummary(result));
        else toast.info(`Nothing to add: ${importSummary(result)}`);
      },
      onError: (error) => toast.error(errorMessage(error)),
      onSettled: () => setAddingId(null),
    });
  };

  const data = listings.data ?? [];
  const missing = data.filter((listing) => !listing.productId && listing.price);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your eBay listings</CardTitle>
        <CardDescription>
          {simulated
            ? "Sample listings standing in for what eBay would report. Adding one creates a product here with its title, price and picture, exactly as with a real listing."
            : "Active listings read from eBay. Adding one creates a product here with its title, price and picture. Nothing is changed on eBay."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {listings.isPending ? (
          <LoadingRows rows={3} label="Loading eBay listings" />
        ) : listings.isError ? (
          <ErrorState error={listings.error} title="Could not load eBay listings" onRetry={() => listings.refetch()} />
        ) : data.length === 0 ? (
          <EmptyState title="No active listings" description="eBay reports no active listings for this account." />
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground" role="status">
                {data.length === 1 ? "1 active listing" : `${data.length} active listings`},{" "}
                {missing.length === 0 ? "all in the inventory" : `${missing.length} not in the inventory yet`}
              </p>
              {missing.length > 0 && (
                <Button onClick={() => run("all")} disabled={importListings.isPending}>
                  <Plus /> {addingId === "all" ? "Adding…" : `Add all ${missing.length} to inventory`}
                </Button>
              )}
            </div>
            <ul className="divide-y" aria-label="eBay listings">
              {data.map((listing) => (
                <ListingRow
                  key={listing.itemId}
                  listing={listing}
                  onAdd={() => run(listing.itemId)}
                  adding={addingId === listing.itemId}
                  disabled={importListings.isPending}
                />
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
