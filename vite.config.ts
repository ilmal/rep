import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { existsSync } from 'node:fs';

// EXTENSION POINT (web push): if public/push-sw.js exists, the generated service worker `importScripts` it
// (served at /app/push-sw.js). It may add 'push' / 'notificationclick' listeners. Skipped when absent so the SW still installs.
const pushSw = existsSync(new URL('./public/push-sw.js', import.meta.url)) ? ['push-sw.js'] : [];

export default defineConfig({
  base: '/app/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['fonts/*.woff2', 'icon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
      manifest: {
        id: '/app/',
        name: 'Rep',
        short_name: 'Rep',
        description: 'Train by the week, not the calendar.',
        theme_color: '#F3F2EF',
        background_color: '#F3F2EF',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/app/?source=pwa',
        scope: '/app/',
        icons: [
          { src: '/app/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/app/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/app/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true, // first install controls the page at once, so the very first session already works offline
        importScripts: pushSw,
        navigateFallback: '/app/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/mcp/],
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
        // Exercise how-to images the athlete/coach attached (any https host): stale-while-revalidate and bounded, so an exercise
        // viewed once still shows its pictures offline. Text content is local state and is always offline. Videos are never cached
        // (range requests, size); same-origin app assets are precached above. Cross-origin <img> responses are opaque (status 0): they are
        // counted at a padded size by the browser, hence the small entry cap + purgeOnQuotaError.
        runtimeCaching: [
          {
            urlPattern: ({ request, url }: { request: Request; url: URL }) => request.destination === 'image' && url.origin !== self.location.origin,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'rep-exercise-images',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 60, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: { port: Number(process.env.VITE_PORT ?? 5173), proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 8787}`, '/mcp': `http://localhost:${process.env.API_PORT ?? 8787}` } },
  build: { outDir: 'dist', sourcemap: false },
});
