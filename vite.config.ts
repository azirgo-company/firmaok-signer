/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// FirmaOK Signer — PWA 100% offline. El service worker precachea TODOS los assets
// (incluido el worker de pdf.js) para que la app firme y valide sin conexión.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // @signpdf usa Buffer; lo polyfilleamos (solo un shim local, sin red).
    nodePolyfills({ include: ['buffer'], globals: { Buffer: true } }),
    VitePWA({
      registerType: 'autoUpdate',
      // No hay backend: precacheamos todo el shell de la app.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm,mjs}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'FirmaOK Signer',
        short_name: 'FirmaOK',
        description: 'Firma y valida documentos PDF 100% offline. Tus datos nunca salen del dispositivo.',
        theme_color: '#2563eb',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'any',
        lang: 'es',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Algunos hostings sirven .mjs como application/octet-stream y el navegador
        // rechaza el module script (el worker de pdf.js). Emitimos esos assets como .js.
        assetFileNames: (assetInfo) =>
          assetInfo.names?.some((n) => n.endsWith('.mjs'))
            ? 'assets/[name]-[hash].js'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
