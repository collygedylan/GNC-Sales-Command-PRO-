import { defineConfig, devices } from '@playwright/test';

const remote = String(process.env.TASK_AV_BLANKS_BASE_URL || '').trim().replace(/\/+$/, '');
const baseURL = remote || 'http://127.0.0.1:43125';

export default defineConfig({
  testDir: './tests', testMatch: /task-av-blanks\.e2e\.spec\.ts/,
  outputDir: './artifacts/task-av-blanks-browser', fullyParallel: false, workers: 1,
  forbidOnly: Boolean(process.env.CI), retries: 0, timeout: 60_000,
  reporter: process.env.CI ? 'github' : 'list', expect: { timeout: 10_000 },
  use: { baseURL, serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'task-av-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'task-av-iphone', use: { ...devices['iPhone 13'] } },
  ],
  webServer: remote ? undefined : {
    command: 'python -m http.server 43125 --bind 127.0.0.1 --directory _site',
    url: baseURL, reuseExistingServer: !process.env.CI, timeout: 20_000,
  },
});
