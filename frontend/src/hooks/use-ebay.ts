import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMe } from "@/hooks/use-auth";
import { productKeys } from "@/hooks/use-products";
import {
  connectSampleEbay,
  disconnectEbay,
  ebayApiBase,
  fetchEbayConnection,
  fetchEbayListings,
  importEbayListings,
} from "@/services/ebay";

export const ebayConnectionKey = ["ebay", "connection"] as const;
export const ebayListingsKey = ["ebay", "listings"] as const;

/** Real eBay routes for the administrator, the simulated ones for the demo account. */
function useEbayBase() {
  return ebayApiBase(useMe().data?.role);
}

export function useEbayConnection() {
  const base = useEbayBase();
  return useQuery({ queryKey: ebayConnectionKey, queryFn: () => fetchEbayConnection(base) });
}

export function useDisconnectEbay() {
  const queryClient = useQueryClient();
  const base = useEbayBase();
  return useMutation({
    mutationFn: () => disconnectEbay(base),
    onSuccess: (connection) => {
      queryClient.setQueryData(ebayConnectionKey, connection);
      queryClient.removeQueries({ queryKey: ebayListingsKey });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

/** Demo account only: connects the sample seller account of the simulated eBay. */
export function useConnectSampleEbay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: connectSampleEbay,
    onSuccess: (connection) => {
      queryClient.setQueryData(ebayConnectionKey, connection);
      void queryClient.invalidateQueries({ queryKey: ebayListingsKey });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

/**
 * Active listings from eBay. Loaded when the eBay page is opened and again on a manual
 * refresh (header button / pull down), like everything else: no polling.
 */
export function useEbayListings(enabled: boolean) {
  const base = useEbayBase();
  return useQuery({ queryKey: ebayListingsKey, queryFn: () => fetchEbayListings(base), enabled, retry: false });
}

export function useImportEbayListings() {
  const queryClient = useQueryClient();
  const base = useEbayBase();
  return useMutation({
    mutationFn: (itemIds?: string[]) => importEbayListings(base, itemIds),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ebayListingsKey }),
        queryClient.invalidateQueries({ queryKey: productKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]),
  });
}
