import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PaginationMeta } from "@/lib/types";

export function Pagination({ meta, onPageChange }: { meta: PaginationMeta; onPageChange: (page: number) => void }) {
  const from = meta.total === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.page * meta.pageSize, meta.total);

  return (
    <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
      <span>
        {from}–{to} of {meta.total}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onPageChange(meta.page - 1)} disabled={meta.page <= 1}>
          <ChevronLeft /> Previous
        </Button>
        <span aria-live="polite">
          Page {meta.page} / {meta.totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(meta.page + 1)}
          disabled={meta.page >= meta.totalPages}
        >
          Next <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
