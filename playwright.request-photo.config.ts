import { defineConfig } from '@playwright/test';
import base from './playwright.verified-data-cache.config';

// Run camera/Request regressions separately against the compiled release shell.
export default defineConfig({
  ...base,
  testMatch: 'request-photo-completion.e2e.spec.ts',
  outputDir: './artifacts/request-photo-browser',
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['json', { outputFile: './artifacts/request-photo-browser/results.json' }],
  ],
});
