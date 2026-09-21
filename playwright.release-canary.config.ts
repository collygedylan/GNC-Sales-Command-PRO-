import { defineConfig, devices } from '@playwright/test';

// Run the hosted, mutation-blocked canaries against the sealed candidate too.
// This catches fixture and navigation changes before they reach production.
export default defineConfig({
  testDir: './tests',
  testMatch: /production-request-canary\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:43144',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: { 'cache-control': 'no-cache, no-store, must-revalidate', pragma: 'no-cache' },
  },
  projects: [
    { name: 'production-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'production-iphone-webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'python -m http.server 43144 --bind 127.0.0.1 --directory _site',
    url: 'http://127.0.0.1:43144',
    reuseExistingServer: false,
    timeout: 20_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
