import { defineConfig, devices } from '@playwright/test';

const remote = String(process.env.DOCKS_FILTER_BASE_URL || '').trim().replace(/\/+$/, '');
const baseURL = remote || 'http://127.0.0.1:43121';

export default defineConfig({
  testDir: './tests', testMatch: /docks-filter\.e2e\.spec\.ts/,
  outputDir: remote ? './test-results/docks-filter-published' : './test-results/docks-filter-local',
  fullyParallel: false, workers: 1, forbidOnly: Boolean(process.env.CI), retries: 0,
  reporter: process.env.CI ? 'github' : 'list', timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { baseURL, serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure',
    extraHTTPHeaders: { 'cache-control': 'no-cache' } },
  projects: [
    { name: 'docks-android', use: { ...devices['Pixel 7'] } },
    { name: 'docks-iphone', use: { ...devices['iPhone 13'] } },
    { name: 'docks-desktop', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: remote ? undefined : {
    command: 'python -m http.server 43121 --bind 127.0.0.1 --directory _site',
    url: baseURL, reuseExistingServer: !process.env.CI, timeout: 20_000
  }
});
