import { defineConfig } from '@playwright/test';
import base from './playwright.verified-data-cache.config';

// Keep Request regression time separate from the inventory-cache matrix.
export default defineConfig({
  ...base,
  testMatch: /.+\.spec\.(ts|js)$/,
  grep: /@request-reliability/,
  outputDir: './artifacts/request-reliability-browser',
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['json', { outputFile: './artifacts/request-reliability-browser/results.json' }],
  ],
});
