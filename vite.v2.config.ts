import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: 'v2',
  base: './',
  test: {
    // React mounts live under v2/src; root-level TypeScript unit/mount suites
    // use the conventional tests/**/*.test.ts(x) location.
    include: ['src/**/*.{test,spec}.{ts,tsx}', '../tests/**/*.test.{ts,tsx}']
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      strategies: 'generateSW',
      manifest: false,
      workbox: {
        importScripts: ['v2-cache-migration.js'],
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/partner\//],
        globPatterns: ['**/*.{html,js,css,svg,png,webp,woff2,json}'],
        globIgnores: ['**/partner/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/partner\//.test(url.pathname),
            handler: 'NetworkOnly'
          },
          {
            // Private partner photos, signed storage URLs, and API responses must never enter this cache.
            urlPattern: ({ request, url, sameOrigin }) => sameOrigin && request.destination === 'image' && !url.search && /^\/assets\/branding\/ag-data-solutions-icon-v2026080925-(192|512)\.png$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'gnc-v2-static-icons-v2',
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 30 }
            }
          }
        ]
      }
    })
  ],
  build: {
    manifest: true,
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true
  }
});
