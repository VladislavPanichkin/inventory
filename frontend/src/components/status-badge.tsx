import { Badge } from "@/components/ui/badge";
import type { ProductStatus, SaleStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const PRODUCT_STATUS_STYLES: Record<ProductStatus, string> = {
  AVAILABLE: "bg-success/15 text-success",
  RESERVED: "bg-warning/15 text-warning",
  SOLD: "bg-destructive/15 text-destructive",
  ARCHIVED: "bg-muted text-muted-foreground",
};

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  AVAILABLE: "Available",
  RESERVED: "Reserved",
  SOLD: "Sold",
  ARCHIVED: "Archived",
};

export function ProductStatusBadge({ status, className }: { status: ProductStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn("border-transparent", PRODUCT_STATUS_STYLES[status], className)}>
      {PRODUCT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function SaleStatusBadge({ status }: { status: SaleStatus }) {
  return status === "CONFIRMED" ? (
    <Badge variant="success">Confirmed</Badge>
  ) : (
    <Badge variant="muted">Cancelled</Badge>
  );
}
