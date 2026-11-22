import { Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { ProductCard, ProductCardSkeleton } from "@/components/product-card";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useProducts } from "@/hooks/use-products";
import type { ProductSortField } from "@/services/products";

const PAGE_SIZE = 24; // divisible by 2, 3 and 4 grid columns

const STATUS_FILTERS = [
  { value: "", label: "Active (not archived)" },
  { value: "AVAILABLE", label: "Available" },
  { value: "RESERVED", label: "Reserved" },
  { value: "SOLD", label: "Sold" },
  { value: "ARCHIVED", label: "Archived" },
  { value: "ALL", label: "All statuses" },
];

/** Sort options as "field:order" pairs (kept in the URL as ?sort=&order=). */
const SORT_OPTIONS: { value: `${ProductSortField}:${"asc" | "desc"}`; label: string }[] = [
  { value: "createdAt:desc", label: "Newest first" },
  { value: "createdAt:asc", label: "Oldest first" },
  { value: "updatedAt:desc", label: "Recently updated" },
  { value: "name:asc", label: "Name A–Z" },
  { value: "name:desc", label: "Name Z–A" },
  { value: "price:asc", label: "Price: low to high" },
  { value: "price:desc", label: "Price: high to low" },
];

export function ProductsPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const status = params.get("status") ?? "";
  const requestedSort = `${params.get("sort") ?? "createdAt"}:${params.get("order") === "asc" ? "asc" : "desc"}`;
  const sortOption = SORT_OPTIONS.find((o) => o.value === requestedSort) ?? SORT_OPTIONS[0]!;
  const [sort, order] = sortOption.value.split(":") as [ProductSortField, "asc" | "desc"];

  const [searchInput, setSearchInput] = useState(params.get("search") ?? "");
  const search = useDebouncedValue(searchInput.trim(), 300);

  const update = (changes: Record<string, string | null>, resetPage = true) => {
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
  };

  // Push the debounced search term into the URL (only reacts to the debounced value).
  useEffect(() => {
    if ((params.get("search") ?? "") !== search) update({ search: search || null });
  }, [search]);

  const query = useProducts({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    status: status || undefined,
    sort,
    order,
  });

  const hasFilters = Boolean(search || status);
  const gridClass = "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5";

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Products"
        description="Each product is one unique physical item."
        actions={
          <Button asChild>
            <Link to="/products/new">
              <Plus /> Add product
            </Link>
          </Button>
        }
      />

      <Card className="gap-4 py-4">
        <CardContent className="flex flex-col gap-3 px-4 md:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Search products"
              placeholder="Search name or eBay item ID…"
              className="pl-10"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 md:flex">
            <NativeSelect
              aria-label="Filter by status"
              className="md:w-52"
              value={status}
              onChange={(e) => update({ status: e.target.value || null })}
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Sort products"
              className="md:w-48"
              value={sortOption.value}
              onChange={(e) => {
                const [nextSort, nextOrder] = e.target.value.split(":");
                update({ sort: nextSort!, order: nextOrder! });
              }}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        </CardContent>
      </Card>

      {query.isPending ? (
        <div className={gridClass} role="status" aria-label="Loading products">
          {Array.from({ length: 8 }, (_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.data.data.length === 0 ? (
        hasFilters ? (
          <EmptyState title="No matching products" description="Try a different search term or status filter." />
        ) : (
          <EmptyState
            title="No products yet"
            description="Add your first item, or import existing eBay listings once eBay is connected."
            action={
              <Button asChild>
                <Link to="/products/new">
                  <Plus /> Add product
                </Link>
              </Button>
            }
          />
        )
      ) : (
        <>
          <ul className={gridClass} aria-label="Products" aria-busy={query.isFetching}>
            {query.data.data.map((product) => (
              <li key={product.id} className="flex">
                <ProductCard product={product} />
              </li>
            ))}
          </ul>
          <Pagination meta={query.data.meta} onPageChange={(p) => update({ page: String(p) }, false)} />
        </>
      )}
    </div>
  );
}
