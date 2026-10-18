import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /queue-hydration-open\.e2e\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  timeout: 90_000,
  expect: { timeout: 5_000 },
  outputDir: '.gnc-local/playwright-v231-queue-hydration',
  use: { baseURL: 'http://127.0.0.1:43123', serviceWorkers: 'block', trace: 'off', screenshot: 'off' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'android-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'python -m http.server 43123 --bind 127.0.0.1 --directory _site',
    url: 'http://127.0.0.1:43123',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
