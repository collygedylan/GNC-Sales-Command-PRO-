import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: /bunch-queue(?:-supervisor)?\.e2e\.spec\.ts$/,
  fullyParallel: false, workers: 1, retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['json', { outputFile: '.gnc-local/v232-browser-report.json' }]], outputDir: '.gnc-local/v232-browser-results', timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:43192', serviceWorkers: 'block', trace: 'off' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'android-chromium-emulation', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-webkit-emulation', use: { ...devices['iPhone 13'] } },
  ],
  webServer: { command: 'python -m http.server 43192 --bind 127.0.0.1 --directory _site', url: 'http://127.0.0.1:43192', reuseExistingServer: false, timeout: 20_000 },
});
