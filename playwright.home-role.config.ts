import { defineConfig, devices } from '@playwright/test';

const remoteBaseURL = String(process.env.HOME_ROLE_BASE_URL || '').trim().replace(/\/+$/, '');
const baseURL = remoteBaseURL || 'http://127.0.0.1:43124';

export default defineConfig({
  testDir: './tests',
  testMatch: /home-role-visibility\.e2e\.spec\.ts/,
  fullyParallel: false,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: { 'cache-control': 'no-cache' },
  },
  projects: [
    { name: 'home-android-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'home-iphone-webkit', use: { ...devices['iPhone 13'] } },
    { name: 'home-tablet-coarse-webkit', use: { ...devices['iPad (gen 7)'] } },
    { name: 'home-desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
  ],
  // Exercise the deployed artifact; all service traffic is isolated by the fixture.
  webServer: remoteBaseURL ? undefined : {
    command: 'python -m http.server 43124 --bind 127.0.0.1 --directory _site',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
