import type { RouteObject } from "react-router";
import { AppLayout } from "@/components/layout/app-layout";
import { RequireAuth } from "@/components/require-auth";
import { LoginPage } from "@/pages/login-page";

/** Pages are code-split: each is downloaded the first time its route is visited. */
export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        path: "/",
        element: <AppLayout />,
        children: [
          { index: true, lazy: async () => ({ Component: (await import("@/pages/dashboard-page")).DashboardPage }) },
          { path: "products", lazy: async () => ({ Component: (await import("@/pages/products-page")).ProductsPage }) },
          {
            path: "products/new",
            lazy: async () => ({ Component: (await import("@/pages/product-form-pages")).ProductNewPage }),
          },
          {
            path: "products/:id",
            lazy: async () => ({ Component: (await import("@/pages/product-details-page")).ProductDetailsPage }),
          },
          {
            path: "products/:id/edit",
            lazy: async () => ({ Component: (await import("@/pages/product-form-pages")).ProductEditPage }),
          },
          { path: "sales", lazy: async () => ({ Component: (await import("@/pages/sales-page")).SalesPage }) },
          {
            path: "settings/ebay",
            lazy: async () => ({ Component: (await import("@/pages/ebay-settings-page")).EbaySettingsPage }),
          },
          { path: "*", lazy: async () => ({ Component: (await import("@/pages/not-found-page")).NotFoundPage }) },
        ],
      },
    ],
  },
];
