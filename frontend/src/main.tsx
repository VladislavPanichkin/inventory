import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { PwaUpdatePrompt } from "@/components/pwa-update-prompt";
import { Toaster } from "@/components/ui/sonner";
import { createQueryClient } from "@/lib/query-client";
import { routes } from "@/routes";
import "./index.css";

const queryClient = createQueryClient();
const router = createBrowserRouter(routes);

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element #root not found");

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
      <PwaUpdatePrompt />
    </QueryClientProvider>
  </StrictMode>,
);
