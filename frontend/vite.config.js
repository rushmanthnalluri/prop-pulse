import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// PropPulse dashboard (ADR-5: Vite + React). The backend URL is configured via
// VITE_API_URL (default http://localhost:8000) — see src/api/client.js.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173, // backend CORS allows http://localhost:5173 (SPEC §8)
  },
  preview: {
    port: 4173,
  },
})
