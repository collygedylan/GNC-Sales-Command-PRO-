import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['production-schedule-mobile.e2e.spec.ts', 'read-optimization-mobile.e2e.spec.ts'],
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { browserName: 'chromium', serviceWorkers: 'block' },
  projects: [
    { name: 'phone-320', use: { viewport: { width: 320, height: 740 }, deviceScaleFactor: 1 } },
    { name: 'phone-390', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 } },
    { name: 'phone-430', use: { viewport: { width: 430, height: 960 }, deviceScaleFactor: 1 } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
  ],
});
