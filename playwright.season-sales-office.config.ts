import { defineConfig, devices } from '@playwright/test';

const remoteBaseURL = String(process.env.SEASON_SALES_OFFICE_BASE_URL || '').trim().replace(/\/+$/, '');
const baseURL = remoteBaseURL || 'http://127.0.0.1:43118';

export default defineConfig({
  testDir: './tests',
  testMatch: /season-sales-office-completion\.e2e\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: { 'cache-control': 'no-cache' },
  },
  projects: [
    { name: 'season-sales-office-android-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'season-sales-office-iphone-webkit', use: { ...devices['iPhone 13'] } },
  ],
  // Build _site first. Only static assets may reach this server (or production).
  webServer: remoteBaseURL ? undefined : {
    command: 'python -m http.server 43118 --bind 127.0.0.1 --directory _site',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
