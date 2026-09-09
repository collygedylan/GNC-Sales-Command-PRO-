import { defineConfig, devices } from '@playwright/test';

const remote = String(process.env.SESSION_RECOVERY_BASE_URL || '').trim().replace(/\/+$/, '');
const baseURL = remote || 'http://127.0.0.1:43126';

export default defineConfig({
  testDir: './tests', testMatch: /session-recovery\.e2e\.spec\.ts/,
  outputDir: './artifacts/session-recovery-browser', fullyParallel: true, workers: 2,
  forbidOnly: Boolean(process.env.CI), retries: 0, timeout: 60_000,
  reporter: process.env.CI ? 'github' : 'list', expect: { timeout: 12_000 },
  use: { baseURL, serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'session-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'session-iphone', use: { ...devices['iPhone 13'] } },
  ],
  webServer: remote ? undefined : {
    command: 'python -m http.server 43126 --bind 127.0.0.1 --directory _site',
    url: baseURL, reuseExistingServer: !process.env.CI, timeout: 20_000,
    stdout: 'ignore', stderr: 'ignore',
  },
});
