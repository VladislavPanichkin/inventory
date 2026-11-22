import { useHealth } from "@/hooks/use-health";
import { cn } from "@/lib/utils";

/** Small header indicator: green when API + database are healthy. */
export function ApiStatusIndicator() {
  const { data, isPending, isError } = useHealth();

  const state = isPending ? "checking" : isError ? "offline" : data.status === "ok" ? "online" : "degraded";
  const label = {
    checking: "Checking connection…",
    online: "System online",
    degraded: "Database unavailable",
    offline: "Server unreachable",
  }[state];

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
      <span
        aria-hidden="true"
        className={cn(
          "size-2 rounded-full",
          state === "online" && "bg-success",
          state === "degraded" && "bg-warning",
          state === "offline" && "bg-destructive",
          state === "checking" && "bg-muted-foreground/40",
        )}
      />
      {label}
    </div>
  );
}
