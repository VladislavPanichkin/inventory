import { Archive, ArrowLeft, Pencil, Tags, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { ChangeStatusDialog } from "@/components/change-status-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EbayListingLink } from "@/components/ebay-listing-link";
import { PageHeader } from "@/components/page-header";
import { ProductPhotos } from "@/components/product-photos";
import { EmptyState, ErrorState, LoadingRows, errorMessage } from "@/components/states";
import { PRODUCT_STATUS_LABELS, ProductStatusBadge, SaleStatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useChangeProductStatus, useDeleteProduct, useProduct, useProductSales, useStatusHistory } from "@/hooks/use-products";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { StatusChange } from "@/lib/types";

const SOURCE_LABELS: Record<StatusChange["source"], string> = {
  MANUAL: "Manual",
  EBAY_ORDER: "eBay order",
  EBAY_CANCELLATION: "eBay cancellation",
  IMPORT: "Import",
  SYSTEM: "System",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function SalesHistory({ productId }: { productId: string }) {
  const sales = useProductSales(productId);
  if (sales.isPending) return <LoadingRows rows={2} label="Loading sales" />;
  if (sales.isError) return <ErrorState error={sales.error} onRetry={() => sales.refetch()} />;
  if (sales.data.length === 0) return <p className="text-sm text-muted-foreground">No eBay sales recorded for this item.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Sold</TableHead>
          <TableHead>eBay order</TableHead>
          <TableHead>Line item</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sales.data.map((sale) => (
          <TableRow key={sale.id}>
            <TableCell>{formatDateTime(sale.soldAt)}</TableCell>
            <TableCell className="font-mono text-xs">{sale.ebayOrderId}</TableCell>
            <TableCell className="font-mono text-xs">{sale.ebayLineItemId}</TableCell>
            <TableCell className="text-right tabular-nums">{formatMoney(sale.soldPrice, sale.currency)}</TableCell>
            <TableCell>
              <SaleStatusBadge status={sale.saleStatus} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function StatusHistory({ productId }: { productId: string }) {
  const history = useStatusHistory(productId);
  if (history.isPending) return <LoadingRows rows={3} label="Loading status history" />;
  if (history.isError) return <ErrorState error={history.error} onRetry={() => history.refetch()} />;
  if (history.data.length === 0) return <p className="text-sm text-muted-foreground">No status changes recorded.</p>;
  return (
    <ol className="grid gap-3" aria-label="Status history">
      {history.data.map((change) => (
        <li key={change.id} className="flex flex-col gap-1 border-l-2 pl-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {change.fromStatus ? (
              <>
                <ProductStatusBadge status={change.fromStatus} />
                <span aria-hidden="true">→</span>
              </>
            ) : null}
            <ProductStatusBadge status={change.toStatus} />
            <Badge variant="outline">{SOURCE_LABELS[change.source]}</Badge>
          </div>
          <span className="text-xs text-muted-foreground">{formatDateTime(change.createdAt)}</span>
          {change.reason && <p className="text-sm">{change.reason}</p>}
        </li>
      ))}
    </ol>
  );
}

export function ProductDetailsPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const query = useProduct(id);
  const changeStatus = useChangeProductStatus();
  const remove = useDeleteProduct();
  const [statusOpen, setStatusOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (query.isPending) return <LoadingRows rows={8} label="Loading product" />;
  if (query.isError) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <ErrorState error={query.error} onRetry={() => query.refetch()} title="Could not load product" />
        <Button variant="outline" asChild className="w-fit">
          <Link to="/products">
            <ArrowLeft /> Back to products
          </Link>
        </Button>
      </div>
    );
  }

  const product = query.data;
  const canDelete = !product.listing; // backend also refuses when sales exist

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Button variant="ghost" size="sm" asChild className="w-fit">
        <Link to="/products">
          <ArrowLeft /> Products
        </Link>
      </Button>

      <PageHeader
        title={product.name}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={`/products/${product.id}/edit`}>
                <Pencil /> Edit
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setStatusOpen(true)}>
              <Tags /> Change status
            </Button>
            {product.status !== "ARCHIVED" && (
              <Button variant="outline" onClick={() => setArchiveOpen(true)}>
                <Archive /> Archive
              </Button>
            )}
            {canDelete && (
              <Button variant="outline" className="text-destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 /> Delete
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Product information</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <div className="w-full shrink-0 sm:w-1/2">
              <ProductPhotos product={product} />
            </div>
            <dl className="grid flex-1 grid-cols-1 content-start gap-4">
              <Field label="Status">
                <ProductStatusBadge status={product.status} />
              </Field>
              <Field label="Price">{formatMoney(product.price, product.currency)}</Field>
              <Field label="Condition">{product.condition ?? "—"}</Field>
              <Field label="Description">
                <p className="whitespace-pre-line">{product.description ?? "—"}</p>
              </Field>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>eBay listing</CardTitle>
          </CardHeader>
          <CardContent>
            {product.listing ? (
              <dl className="grid gap-4">
                <Field label="eBay item ID">
                  <EbayListingLink listing={product.listing} />
                </Field>
                <Field label="Listing URL">
                  {product.listing.listingUrl ? (
                    <a
                      href={product.listing.listingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all underline-offset-4 hover:underline"
                    >
                      {product.listing.listingUrl}
                    </a>
                  ) : (
                    "—"
                  )}
                </Field>
                <Field label="Marketplace">{product.listing.marketplaceId}</Field>
                <Field label="Listing status">{product.listing.listingStatus}</Field>
                <Field label="Last synced">{formatDateTime(product.listing.lastSyncedAt)}</Field>
              </dl>
            ) : (
              <EmptyState title="Not linked to eBay" description="Listings are linked through the eBay import (coming in a later phase)." />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Sales history</CardTitle>
          </CardHeader>
          <CardContent>
            <SalesHistory productId={product.id} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Status history</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusHistory productId={product.id} />
          </CardContent>
        </Card>
      </div>

      <ChangeStatusDialog product={product} open={statusOpen} onOpenChange={setStatusOpen} />

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive product?"
        description={`It will be hidden from the default product list. Current status: ${PRODUCT_STATUS_LABELS[product.status]}. History is kept.`}
        confirmLabel="Archive"
        destructive
        pending={changeStatus.isPending}
        onConfirm={() =>
          changeStatus.mutate(
            { id: product.id, status: "ARCHIVED", reason: "Archived from product page" },
            {
              onSuccess: () => {
                toast.success("Product archived");
                setArchiveOpen(false);
              },
              onError: (error) => toast.error(errorMessage(error)),
            },
          )
        }
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete product permanently?"
        description="This cannot be undone. Products with eBay sales can't be deleted; archive them instead."
        confirmLabel="Delete"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(product.id, {
            onSuccess: () => {
              toast.success(`Deleted ${product.name}`);
              navigate("/products", { replace: true });
            },
            onError: (error) => {
              toast.error(errorMessage(error));
              setDeleteOpen(false);
            },
          })
        }
      />
    </div>
  );
}
