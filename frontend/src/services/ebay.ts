import { API_BASE, apiRequest } from "@/lib/api-client";
import type { Admin, EbayActiveListing, EbayConnection, EbayImportResult } from "@/lib/types";

/**
 * Where the eBay endpoints live for the signed-in account. The demo account talks to a
 * simulated eBay (sample seller, sample listings) with the same request and response
 * shapes; the server refuses it on the real eBay routes.
 */
export type EbayApiBase = "/integrations/ebay" | "/demo/ebay";

export const ebayApiBase = (role: Admin["role"] | undefined): EbayApiBase =>
  role === "DEMO" ? "/demo/ebay" : "/integrations/ebay";

/**
 * Starting the real eBay connection is a full-page navigation: the backend redirects the
 * browser to eBay's consent page and eBay redirects back to the backend's callback.
 * (The service worker never intercepts /api navigations.)
 */
export const EBAY_CONNECT_URL = `${API_BASE}/integrations/ebay/connect`;

export const fetchEbayConnection = async (base: EbayApiBase) =>
  (await apiRequest<{ data: EbayConnection }>(base)).data;

export const disconnectEbay = async (base: EbayApiBase) =>
  (await apiRequest<{ data: EbayConnection }>(`${base}/disconnect`, { method: "POST" })).data;

/** Demo only: connects the sample seller account (stands in for eBay's sign-in and consent). */
export const connectSampleEbay = async () =>
  (await apiRequest<{ data: EbayConnection }>("/demo/ebay/connect", { method: "POST" })).data;

/** The seller's active listings, read live from eBay by the backend. */
export const fetchEbayListings = async (base: EbayApiBase) =>
  (await apiRequest<{ data: EbayActiveListing[] }>(`${base}/listings`)).data;

/** Creates products from eBay listings. Without item IDs, every listing not yet in the inventory. */
export const importEbayListings = async (base: EbayApiBase, itemIds?: string[]) =>
  (
    await apiRequest<{ data: EbayImportResult }>(`${base}/listings/import`, {
      method: "POST",
      body: itemIds ? { itemIds } : {},
    })
  ).data;
