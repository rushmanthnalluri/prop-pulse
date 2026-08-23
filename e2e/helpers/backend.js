/**
 * E2E backend self-healing guard.
 *
 * The audit-blackbox and dashboard specs deliberately stop the E2E backend on
 * :8200 ("LAST" scenarios). Any spec that needs live API data must re-ensure
 * the backend before it runs, or the whole suite cascades the way it did on
 * 2026-08-10 (backend down at suite start → 8×90s /predict timeouts → the
 * audit-blackbox kill-test failed because `killPort` found nothing → dashboard
 * + frontend-fixes failed/skipped).
 *
 * Usage (any spec with backend-dependent tests):
 *
 *     import { ensureBackend } from '../helpers/backend.js'
 *     test.beforeAll(async () => { await ensureBackend() })
 *
 * Kept dependency-free of @playwright/test so it can run anywhere (the health
 * poll is a plain deadline loop, not `expect.poll`).
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** E2E-owned ports (see e2e/playwright.config.js). */
export const BACKEND_PORT = 8200
export const BACKEND_ORIGIN = `http://localhost:${BACKEND_PORT}`
export const FRONTEND_ORIGIN = 'http://localhost:5300'

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** True once /health returns 200, false on deadline (kept polling). */
export async function waitForHealth(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BACKEND_ORIGIN}/health`)).status === 200) return true
    } catch {
      /* still down — keep polling */
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  return false
}

/**
 * Respawn the E2E backend detached (same command as README/E2E.md) if :8200
 * is not answering, then wait for it to become healthy. Never throws on a
 * down-backend; throws only if a respawn was needed and never came up.
 */
export async function ensureBackend() {
  let wasUp = false
  try {
    wasUp = (await fetch(`${BACKEND_ORIGIN}/health`)).status === 200
  } catch {
    /* down — respawn below */
  }
  if (wasUp) return

  spawn(
    path.join(REPO_ROOT, '.venv', 'Scripts', 'python.exe'),
    ['-m', 'uvicorn', 'backend.app.main:app', '--port', String(BACKEND_PORT)],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, CORS_ORIGINS: FRONTEND_ORIGIN },
      detached: true,
      stdio: 'ignore',
    },
  ).unref()

  if (!(await waitForHealth())) {
    throw new Error(`E2E backend failed to become healthy on ${BACKEND_ORIGIN}`)
  }
}
