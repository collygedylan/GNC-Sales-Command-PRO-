import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /bunch-note\.e2e\.spec\.ts$/,
  grep: /Next and Save draft stay in normal flow below setup controls while scrolling/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: '.gnc-local/v231-bunch-actions-output',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:43157',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'android-chromium-emulation', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-webkit-emulation', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'python -m http.server 43157 --bind 127.0.0.1',
    url: 'http://127.0.0.1:43157',
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
