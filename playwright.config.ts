import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /(responsive-workflows\.e2e|request-integrity-local|eval-work\.e2e|scroll-performance\.e2e|photo-egress\.e2e|photo-history\.e2e|sales-marketing-tasks\.e2e)\.spec\.(ts|js)/,
  fullyParallel: true,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:43116',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'python -m http.server 43116 --bind 127.0.0.1',
    url: 'http://127.0.0.1:43116',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
