import { defineConfig, devices } from '@playwright/test';

// These tests mutate only the isolated CI Supabase stack. Do not inherit the
// broad UI config's testMatch: it previously excluded native provisioning even
// when that file was named explicitly on the command line.
const localUrl = String(process.env.SUPABASE_LOCAL_URL || '').trim();
if (process.env.CI) {
  const target = new URL(localUrl || 'http://invalid');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
      || !process.env.SUPABASE_LOCAL_ANON_KEY
      || !process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY) {
    throw new Error('Database browser tests require the isolated loopback Supabase environment.');
  }
}

export default defineConfig({
  testDir: './tests',
  testMatch: ['request-integrity-local.spec.js', 'native-auth-provisioning-local.spec.js'],
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['json', { outputFile: 'test-results/database/results.json' }],
       ['html', { outputFolder: 'playwright-report/database', open: 'never' }]]
    : 'list',
  outputDir: 'test-results/database/traces',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:43116', serviceWorkers: 'block', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'python -m http.server 43116 --bind 127.0.0.1',
    url: 'http://127.0.0.1:43116',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
