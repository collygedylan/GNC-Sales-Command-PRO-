import { defineConfig, devices } from '@playwright/test';

const baseURLValue = String(process.env.TEARDOWN_STAGING_BASE_URL || '').trim().replace(/\/+$/, '');
const username = String(process.env.TEARDOWN_STAGING_USERNAME || '').trim();
const accessCode = String(process.env.TEARDOWN_STAGING_ACCESS_CODE || '');
if (!baseURLValue || !username || !accessCode) throw new Error('Hosted staging auth requires TEARDOWN_STAGING_BASE_URL, TEARDOWN_STAGING_USERNAME and TEARDOWN_STAGING_ACCESS_CODE.');
const baseURL = `${baseURLValue}/`;

export default defineConfig({
  testDir: './browser',
  testMatch: /staging-hosted-auth\.e2e\.spec\.ts/,
  outputDir: '../test-results/staging-auth',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? 'github' : 'list',
  // Real sign-in traces would retain passwords and session headers.
  use: { baseURL, serviceWorkers: 'block', trace: 'off', screenshot: 'only-on-failure' },
  projects: [
    { name: 'staging-hosted-android', use: { ...devices['Galaxy S9'] } },
    { name: 'staging-hosted-iphone', use: { ...devices['iPhone 13'] } },
  ],
});
