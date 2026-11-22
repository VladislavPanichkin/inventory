import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

/**
 * Generates the PWA icons in public/ from public/icon.svg.
 * Run after changing the icon:  npm run pwa:icons -w frontend
 *
 * icon.svg already has a full-bleed dark background with the glyph inside the
 * maskable safe zone, so no extra padding (the default would add a white border).
 */
const background = "#171717";

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    transparent: { ...minimal2023Preset.transparent, padding: 0 },
    maskable: { ...minimal2023Preset.maskable, padding: 0, resizeOptions: { background } },
    apple: { ...minimal2023Preset.apple, padding: 0, resizeOptions: { background } },
  },
  images: ["public/icon.svg"],
});
