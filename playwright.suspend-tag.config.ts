import { defineConfig, devices } from '@playwright/test';

const remoteBaseURL = String(process.env.SUSPEND_TAG_BASE_URL || '').trim().replace(/\/+$/, '');
const baseURL = remoteBaseURL || 'http://127.0.0.1:43120';

export default defineConfig({
  testDir: './tests',
  testMatch: /suspend-tag-completion\.e2e\.spec\.ts/,
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
    { name: 'suspend-tag-android-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'suspend-tag-iphone-webkit', use: { ...devices['iPhone 13'] } },
  ],
  // Build _site first. Remote mode also blocks every real service request.
  webServer: remoteBaseURL ? undefined : {
    command: 'python -m http.server 43120 --bind 127.0.0.1 --directory _site',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
