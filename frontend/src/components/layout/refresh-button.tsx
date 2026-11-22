import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function RefreshButton({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onRefresh}
      disabled={refreshing}
      aria-label={refreshing ? "Refreshing" : "Refresh"}
      title="Refresh"
    >
      <RefreshCw className={cn(refreshing && "animate-spin")} />
    </Button>
  );
}
