import { defineConfig, devices } from '@playwright/test';

const remoteBase = String(process.env.LOGIN_PHOTO_BASE_URL || '').trim();
export default defineConfig({
  testDir:'./tests',
  testMatch:'login-photo-repair.e2e.spec.ts',
  fullyParallel:true,
  workers:1,
  forbidOnly:!!process.env.CI,
  retries:process.env.CI ? 1 : 0,
  reporter:process.env.CI ? 'github' : 'list',
  timeout:60_000,
  use:{ baseURL:remoteBase || 'http://127.0.0.1:43116', serviceWorkers:'block', trace:'retain-on-failure' },
  projects:[
    { name:'chromium', use:{ ...devices['Desktop Chrome'] } },
    { name:'firefox', use:{ ...devices['Desktop Firefox'] } },
    { name:'webkit', use:{ ...devices['Desktop Safari'] } },
    { name:'android', use:{ ...devices['Pixel 7'] } },
  ],
  webServer:remoteBase ? undefined : {
    command:'python -m http.server 43116 --bind 127.0.0.1',
    url:'http://127.0.0.1:43116', reuseExistingServer:!process.env.CI, timeout:20_000,
    stdout:'ignore', stderr:'ignore',
  },
});
