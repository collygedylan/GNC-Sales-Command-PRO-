import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Keep the original browser projects and retry policy. Timing assertions run
// serially, without competing browser workers or per-request server logging.
export default defineConfig({
  ...base,
  testMatch: /(?:scroll-performance|login-photo-repair)\.e2e\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  webServer: {
    command: 'node scripts/serve-release-tests.mjs',
    url: 'http://127.0.0.1:43116',
    reuseExistingServer: false,
    timeout: 20_000,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
