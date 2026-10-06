import { defineConfig, devices } from '@playwright/test';

const remote = String(process.env.TEARDOWN_STAGING_BASE_URL || '').trim().replace(/\/+$/, '');
const baseURL = remote ? `${remote}/` : 'http://127.0.0.1:43191/gnc-teardown-staging/staging/';

export default defineConfig({
  testDir: './browser',
  testMatch: /staging-boundary\.e2e\.spec\.ts/,
  outputDir: '../test-results/staging',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure' },
  projects: [
    { name: 'android', use: { ...devices['Galaxy S9'] } },
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
  ],
  webServer: remote ? undefined : {
    command: 'node scripts/staging/static-server.mjs --root _staging --prefix gnc-teardown-staging/ --port 43191',
    url: baseURL,
    cwd: process.cwd(),
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
    stdout: 'ignore', stderr: 'ignore',
  },
});
