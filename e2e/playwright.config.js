/**
 * Playwright config for the PropPulse dashboard E2E suite.
 *
 * - Chromium only, retries 0, sequential (workers 1) because the backend-kill
 *   scenarios deliberately stop the E2E backend on port 8200.
 * - baseURL points at the Vite dev server on the E2E-assigned port 5300
 *   (backend lives on 8200; both are started externally — see reports/E2E.md).
 *   WP-7a note: ports moved 5200/8100 → 5300/8200 so the suite never has to
 *   touch servers left running by other work streams.
 */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5300',
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'off',
  },
})
