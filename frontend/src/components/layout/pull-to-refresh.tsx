import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Pull distance (after resistance) needed to trigger a refresh. */
export const PULL_THRESHOLD_PX = 70;
const MAX_PULL_PX = 110;
const RESISTANCE = 0.5;

/**
 * Touch pull-down-to-refresh for the page. Installed PWAs (standalone mode) have no
 * browser pull-to-refresh, so the app provides its own. It only starts when the page is
 * scrolled to the very top, the gesture is mainly vertical, and no dialog is open.
 * The browser's own overscroll refresh is disabled in CSS to avoid double refreshes.
 */
export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<unknown>; children: ReactNode }) {
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const gesture = useRef<{ startX: number; startY: number; distance: number } | null>(null);
  const refreshingRef = useRef(false);

  useEffect(() => {
    const dialogOpen = () => document.body.hasAttribute("data-scroll-locked");

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (refreshingRef.current || event.touches.length !== 1 || !touch || window.scrollY > 0 || dialogOpen()) return;
      gesture.current = { startX: touch.clientX, startY: touch.clientY, distance: 0 };
    };

    const onMove = (event: TouchEvent) => {
      const current = gesture.current;
      const touch = event.touches[0];
      if (!current || !touch) return;
      const dy = touch.clientY - current.startY;
      const dx = touch.clientX - current.startX;
      if (dy <= 0 || Math.abs(dx) > dy || window.scrollY > 0) {
        // Scrolling up, horizontal swipe or page scrolled: not a pull.
        gesture.current = null;
        setPull(0);
        setDragging(false);
        return;
      }
      if (event.cancelable) event.preventDefault(); // stop native overscroll/bounce while pulling
      current.distance = Math.min(MAX_PULL_PX, dy * RESISTANCE);
      setDragging(true);
      setPull(current.distance);
    };

    const onEnd = () => {
      const current = gesture.current;
      gesture.current = null;
      setDragging(false);
      setPull(0);
      if (!current || current.distance < PULL_THRESHOLD_PX) return;
      refreshingRef.current = true;
      setRefreshing(true);
      void onRefreshRef.current().finally(() => {
        refreshingRef.current = false;
        setRefreshing(false);
      });
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const height = refreshing ? 48 : pull;
  const ready = pull >= PULL_THRESHOLD_PX;

  return (
    <>
      <div
        aria-hidden="true"
        data-testid="pull-indicator"
        className={cn(
          "flex items-end justify-center overflow-hidden text-xs text-muted-foreground",
          !dragging && "transition-[height] duration-200",
        )}
        style={{ height }}
      >
        <div className="flex items-center gap-2 pb-3">
          <RefreshCw
            className={cn("size-4", refreshing && "animate-spin")}
            style={refreshing ? undefined : { transform: `rotate(${(pull / PULL_THRESHOLD_PX) * 270}deg)` }}
          />
          {refreshing ? "Refreshing…" : ready ? "Release to refresh" : pull > 0 ? "Pull to refresh" : null}
        </div>
      </div>
      {children}
    </>
  );
}
