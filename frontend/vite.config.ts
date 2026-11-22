/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const backendUrl = process.env.BACKEND_URL ?? "http://localhost:3000";

// The browser only talks to the Vite origin; /api is proxied to the backend.
// This keeps session cookies first-party and avoids CORS in development.
const apiProxy = { "/api": { target: backendUrl, changeOrigin: false } };

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // A new version waits until the user taps "Reload" (never reloads mid-edit).
      registerType: "prompt",
      // Registered from React (src/components/pwa-update-prompt.tsx).
      injectRegister: false,
      includeAssets: ["favicon.ico", "icon.svg", "apple-touch-icon-180x180.png"],
      manifest: {
        id: "/",
        name: "Inventory Admin",
        short_name: "Inventory",
        description: "Private inventory admin with eBay sales synchronization.",
        lang: "en",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#fafafa",
        theme_color: "#ffffff",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precache only the app shell (code, styles, icons). Business data is NEVER cached:
        // there is deliberately no runtimeCaching rule, so /api always goes to the network
        // and the UI can never show a stale (e.g. already sold) status from a cache.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
        navigateFallback: "/index.html",
        // Navigations to /api (e.g. the eBay OAuth callback in Phase 3) must reach the server.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  // `npm run preview` serves the production build (with the service worker) on :4173.
  preview: {
    port: 4173,
    strictPort: true,
    proxy: apiProxy,
  },
  build: {
    rollupOptions: {
      output: {
        // Third-party code in separate chunks: cached by browsers across app releases.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/.test(id)) return "vendor-react";
          if (/[\\/]node_modules[\\/](zod|react-hook-form|@hookform)[\\/]/.test(id)) return "vendor-forms";
          return "vendor";
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
