import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end specs drive this plugin inside a real DSH web GUI.
 *
 * The unit suite (`pnpm test`) already covers component logic under jsdom; what
 * only a browser can answer is whether the plugin survives the real boot —
 * whether its client bundle loads at all, whether its settings page lands in the
 * shell's navigation, whether its launchers are on screen. The host is a
 * throwaway instance on its own `DSH_HOME`, started and killed by `e2e/host.mjs`;
 * the plugin is linked into it, never copied, so the specs grade the working tree.
 *
 * The port is fixed because the host needs a concrete `--port` and the fence
 * binds its session cookie to the authority; `127.0.0.1` (not `localhost`) is
 * part of that binding.
 */
const PORT = Number(process.env.DSH_E2E_PORT ?? '3311')
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  // Screenshots and traces are for reading after a failure, not for grading:
  // nothing in this suite asserts on a picture.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['blob'], ['github']]
    : [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // A hung run must leave its report behind, so the cap belongs here and not in
  // the CI job's `timeout-minutes`.
  globalTimeout: process.env.CI ? 20 * 60_000 : undefined,

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Pinned: the shell derives its UI language from the browser, and the
    // settings entry the specs click is labelled in it.
    locale: 'zh-CN',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'node e2e/host.mjs',
    // The trust fence answers an unauthenticated request with 401, which
    // Playwright counts as ready (it accepts anything from 200 to 403).
    url: `${BASE_URL}/`,
    env: { DSH_E2E_PORT: String(PORT) },
    // The build runs inside the host script; a cold JS build plus a DSH boot
    // needs more than the 60s default.
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    reuseExistingServer: false,
  },
})
