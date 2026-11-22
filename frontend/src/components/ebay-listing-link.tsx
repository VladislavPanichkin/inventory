import { ExternalLink } from "lucide-react";
import type { EbayListingSummary } from "@/lib/types";

/** Shows the eBay item ID, linked only when eBay gave us a real listing URL (never constructed). */
export function EbayListingLink({ listing }: { listing: EbayListingSummary | null }) {
  if (!listing) return <span className="text-muted-foreground">—</span>;

  if (listing.listingUrl) {
    return (
      <a
        href={listing.listingUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-mono text-xs underline-offset-4 hover:underline"
        title={`Open on eBay (${listing.marketplaceId})`}
      >
        {listing.ebayItemId}
        <ExternalLink className="size-3" aria-hidden="true" />
      </a>
    );
  }
  return (
    <span className="font-mono text-xs" title={listing.marketplaceId}>
      {listing.ebayItemId}
    </span>
  );
}
