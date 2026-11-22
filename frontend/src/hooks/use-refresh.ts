import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { ME_QUERY_KEY } from "@/lib/query-client";

/**
 * Manual "refresh everything" (header button and pull-to-refresh). Reloads every query
 * currently on screen and marks the rest stale so they reload when next shown.
 * Phase 5 will extend this to ask the backend to sync sale status from eBay first.
 */
export function useRefreshAll() {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(() => {
    // Ignore repeated taps/pulls while a refresh is running.
    inFlight.current ??= (async () => {
      setIsRefreshing(true);
      try {
        await queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== ME_QUERY_KEY[0] });
      } finally {
        setIsRefreshing(false);
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }, [queryClient]);

  return { refresh, isRefreshing };
}
