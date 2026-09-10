import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const canaryBaseURL = String(process.env.CANARY_BASE_URL || '').trim().replace(/\/+$/, '');

// Local runs require npm run build:live:shell and load /_site. A supplied
// CANARY_BASE_URL uses the published root with all write requests blocked.
export default defineConfig({
  ...base,
  testMatch: /review-assignedto\.e2e\.spec\.ts/,
  use: {
    ...base.use,
    baseURL: canaryBaseURL || base.use?.baseURL,
  },
  webServer: canaryBaseURL ? undefined : base.webServer,
});
