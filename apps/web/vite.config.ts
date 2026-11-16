import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const server = process.env.CALEPIN_SERVER ?? "http://localhost:3000";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Calepin",
        short_name: "Calepin",
        description: "Self-hosted notes, docs and databases",
        theme_color: "#1b1918",
        background_color: "#1b1918",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/collab/, /^\/mcp/, /^\/s\//],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": { target: server, changeOrigin: false },
      "/collab": { target: server.replace(/^http/, "ws"), ws: true },
      "/mcp": { target: server },
      "/s/": { target: server },
    },
  },
  build: { chunkSizeWarningLimit: 2000 },
});
