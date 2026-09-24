import { defineConfig, devices } from '@playwright/test';

const remote = String(process.env.APP_LIFECYCLE_BASE_URL || '').trim().replace(/\/+$/, '');
const baseURL = remote || 'http://127.0.0.1:43139';
const siteDir = String(process.env.APP_LIFECYCLE_SITE_DIR || '_site').trim() || '_site';

export default defineConfig({
  testDir: './tests',
  testMatch: /app-lifecycle\.e2e\.spec\.ts/,
  outputDir: './test-results/lifecycle',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 70_000,
  expect: { timeout: 12_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: { 'cache-control': 'no-cache' },
  },
  projects: [
    { name: 'lifecycle-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'lifecycle-iphone', use: { ...devices['iPhone 13'] } },
  ],
  webServer: remote ? undefined : {
    command: `python -m http.server 43139 --bind 127.0.0.1 --directory ${JSON.stringify(siteDir)}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
