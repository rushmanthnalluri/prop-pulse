import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// PropPulse dashboard (ADR-5: Vite + React). The backend URL is configured via
// VITE_API_URL (default http://localhost:8000) — see src/api/client.js.
// Backend route prefixes the SPA calls (root-level API, no /api prefix).
// Proxied so the app can be served from one origin (LAN share / tunnel) when
// VITE_API_URL is set to "/". Browser navigations to same-named SPA pages
// (Accept: text/html) bypass the proxy and fall through to React Router.
const API_PREFIXES = ['/health', '/metrics', '/predict', '/model', '/market', '/workflow']

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173, // backend CORS allows http://localhost:5173 (SPEC §8)
    // Allow Cloudflare quick-tunnel hostnames (random per session) for sharing.
    allowedHosts: ['.trycloudflare.com'],
    proxy: Object.fromEntries(
      API_PREFIXES.map((prefix) => [
        prefix,
        {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          bypass: (req) =>
            (req.headers.accept || '').includes('text/html') ? req.url : undefined,
        },
      ]),
    ),
  },
  preview: {
    port: 4173,
  },
})
