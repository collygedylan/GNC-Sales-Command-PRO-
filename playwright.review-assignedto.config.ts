import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// The production shell must be built before this suite: npm run build:live:shell.
// Tests load /_site and route unchanged static dependencies to the repository.
export default defineConfig({
  ...base,
  testMatch: /review-assignedto\.e2e\.spec\.ts/,
});
