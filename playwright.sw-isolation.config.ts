import { defineConfig, devices } from '@playwright/test';

// This server deliberately serves a harmless fixture at / and /index.html,
// the real patched worker at /sw.js, and the production-built test app at /v2/.
// Never point this suite at production: it creates synthetic CacheStorage entries.
export default defineConfig({
  testDir: './tests',
  testMatch: /service-worker-isolation\.e2e\.spec\.ts/,
  outputDir: 'test-results/sw-isolation',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://127.0.0.1:43126',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'sw-isolation-chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } },
    { name: 'sw-isolation-webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
