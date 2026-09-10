import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// CI shards this suite across four runners, each with one browser worker.
// Database integration and timing-sensitive tests have dedicated jobs.
export default defineConfig({
  ...base,
  workers: 1,
  testIgnore: [
    /request-integrity-local\.spec\.js$/,
    /(?:scroll-performance|login-photo-repair)\.e2e\.spec\.ts$/,
  ],
  webServer: {
    command: 'node scripts/serve-release-tests.mjs',
    url: 'http://127.0.0.1:43116',
    reuseExistingServer: false,
    timeout: 20_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
