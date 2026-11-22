import { MutationCache, QueryCache, QueryClient, type DefaultOptions } from "@tanstack/react-query";
import { ApiError } from "@/lib/api-client";
import type { Admin } from "@/lib/types";

export const ME_QUERY_KEY = ["auth", "me"] as const;

/**
 * Refresh policy (owner decision): no background polling and no refetch on window focus.
 * Data is loaded on app start, refreshed after the admin's own changes (mutations
 * invalidate the affected queries), and on manual refresh (pull-down / refresh button,
 * see use-refresh.ts) or a page reload. Hence `staleTime: Infinity`.
 *
 * Any 401 from the API (expired/revoked session) marks the user as logged out;
 * the route guard then redirects to the login page.
 *
 * The demo account has a limited number of changes: after each of its changes the account
 * is re-read, so the "changes left" banner stays correct.
 */
export function createQueryClient(defaultOptions: DefaultOptions = {}) {
  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.isUnauthorized) {
      queryClient.setQueryData(ME_QUERY_KEY, null);
    }
  };

  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({
      onError,
      onSettled: () => {
        const me = queryClient.getQueryData<Admin | null>(ME_QUERY_KEY);
        if (me?.role === "DEMO") void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      },
    }),
    defaultOptions: {
      ...defaultOptions,
      queries: {
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        // Retry transient failures once; never retry client errors (4xx).
        retry: (failureCount, error) =>
          failureCount < 1 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
        ...defaultOptions.queries,
      },
      mutations: {
        // Never queue a change while offline to replay it later against possibly changed
        // data: attempt immediately and show the network error instead.
        networkMode: "always",
        ...defaultOptions.mutations,
      },
    },
  });
  return queryClient;
}
