import { defineConfig, devices } from '@playwright/test';

const remoteBaseURL = String(process.env.FOOTER_BASE_URL || '').trim().replace(/\/+$/, '');
const baseURL = remoteBaseURL || 'http://127.0.0.1:43117';

export default defineConfig({
  testDir: './tests',
  testMatch: /footer-navigation\.e2e\.spec\.ts/,
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
    { name: 'footer-android-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'footer-iphone-webkit', use: { ...devices['iPhone 13'] } },
    { name: 'footer-desktop-firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  // This suite intentionally serves the deployment artifact, never the raw index.html.
  // Run build:live:shell after preparing _site's assets, as the Pages workflow does.
  webServer: remoteBaseURL ? undefined : {
    command: 'python -m http.server 43117 --bind 127.0.0.1 --directory _site',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
