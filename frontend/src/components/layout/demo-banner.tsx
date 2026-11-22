import { FlaskConical } from "lucide-react";
import { useMe } from "@/hooks/use-auth";

/**
 * Shown to the demo account only: explains that this is sample data and how many changes
 * are left. The server enforces the limit; this just keeps the visitor informed.
 */
export function DemoBanner() {
  const { data: me } = useMe();
  if (!me || me.role !== "DEMO" || !me.demo) return null;

  const left = Math.max(0, me.demo.changesLimit - me.demo.changesUsed);
  return (
    <div role="status" className="flex items-start gap-2 border-b bg-accent px-4 py-2 text-sm text-foreground md:px-8">
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p>
        <span className="font-medium">Demo account.</span> Sample data, restored at every sign-in.{" "}
        {left > 0 ? (
          <span className="font-medium tabular-nums">
            {left} of {me.demo.changesLimit} {me.demo.changesLimit === 1 ? "change" : "changes"} left.
          </span>
        ) : (
          <span className="font-medium">No changes left. Sign out and in again to start over.</span>
        )}
      </p>
    </div>
  );
}
