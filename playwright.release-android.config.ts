import { defineConfig } from '@playwright/test';
import login from './playwright.login-photo.config';
import timing from './playwright.release-timing.config';

// Preserve the Android startup/photo assertions while serving the same sealed
// package as the desktop timing lane. The ordinary login config is unchanged.
export default defineConfig({
  ...login,
  fullyParallel: false,
  workers: 1,
  projects: login.projects?.filter(project => project.name === 'android'),
  use: { ...login.use, baseURL: timing.use?.baseURL },
  webServer: timing.webServer,
});
