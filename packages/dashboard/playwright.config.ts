import { defineConfig, devices } from '@playwright/test'

// `vite preview` resolves a bare `localhost` to ::1 only, which Playwright's
// IPv4 readiness probe never reaches. Bind both ends to 127.0.0.1 explicitly.
const HOST = '127.0.0.1'
const PORT = 4173
const baseURL = `http://${HOST}:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Serves the production build — the same `dist/` the CLI's API server ships
  // as static assets. `npm run test:e2e` builds first; running `playwright
  // test` directly reuses whatever is already in `dist/`.
  webServer: {
    command: `npx vite preview --host ${HOST} --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
