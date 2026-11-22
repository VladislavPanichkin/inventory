import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/use-online-status";

/**
 * Shown while the device is offline. Data is never served from a cache, so the
 * admin must know that what's on screen is the last loaded state and that
 * changes can't be saved right now.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b bg-warning/15 px-4 py-2 text-sm text-foreground md:px-8">
      <WifiOff className="size-4 shrink-0 text-warning" aria-hidden="true" />
      You're offline. Showing the last loaded data. Changes can't be saved until you reconnect.
    </div>
  );
}
