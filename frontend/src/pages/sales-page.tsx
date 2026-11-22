import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { EmptyState, ErrorState, LoadingRows } from "@/components/states";
import { SaleStatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSales } from "@/hooks/use-sales-dashboard";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { SaleStatus } from "@/lib/types";

export function SalesPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const statusParam = params.get("status");
  const status: SaleStatus | undefined = statusParam === "CONFIRMED" || statusParam === "CANCELLED" ? statusParam : undefined;
  const [searchInput, setSearchInput] = useState(params.get("search") ?? "");
  const search = useDebouncedValue(searchInput.trim(), 300);

  const update = (changes: Record<string, string | null>, resetPage = true) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        if (resetPage) next.delete("page");
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    if ((params.get("search") ?? "") !== search) update({ search: search || null });
  }, [search]);

  const query = useSales({ page, pageSize: 20, search: search || undefined, status });

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader title="Sales" description="Sales detected from eBay orders. Newest first." />

      <Card className="gap-4 py-4">
        <CardContent className="flex flex-col gap-3 px-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Search sales"
              placeholder="Search eBay order ID or product name…"
              className="pl-10"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <NativeSelect
            aria-label="Filter by sale status"
            className="sm:w-48"
            value={status ?? ""}
            onChange={(e) => update({ status: e.target.value || null })}
          >
            <option value="">All sales</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="CANCELLED">Cancelled</option>
          </NativeSelect>
        </CardContent>
      </Card>

      {query.isPending ? (
        <LoadingRows rows={8} label="Loading sales" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.data.data.length === 0 ? (
        <EmptyState
          title={search || status ? "No matching sales" : "No sales yet"}
          description={search || status ? "Try a different search or filter." : "Sales appear here automatically once eBay is connected and an item sells."}
        />
      ) : (
        <Card className="gap-0 py-0">
          <Table aria-busy={query.isFetching}>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>eBay order ID</TableHead>
                <TableHead>Line item ID</TableHead>
                <TableHead className="text-right">Sale price</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Sale date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.data.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell className="max-w-72 truncate">
                    <Link to={`/products/${sale.product.id}`} className="font-medium hover:underline">
                      {sale.product.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{sale.ebayOrderId}</TableCell>
                  <TableCell className="font-mono text-xs">{sale.ebayLineItemId}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(sale.soldPrice, sale.currency)}</TableCell>
                  <TableCell>{sale.currency}</TableCell>
                  <TableCell>{formatDateTime(sale.soldAt)}</TableCell>
                  <TableCell>
                    <SaleStatusBadge status={sale.saleStatus} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="border-t px-4 py-3">
            <Pagination meta={query.data.meta} onPageChange={(p) => update({ page: String(p) }, false)} />
          </div>
        </Card>
      )}
    </div>
  );
}
