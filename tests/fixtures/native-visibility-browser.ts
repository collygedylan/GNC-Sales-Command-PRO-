import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Playwright normally forces every tab visible. Use its supported noDefaults
 * connection so Chromium produces real, trusted background/foreground events. */
export async function nativeVisibilityBrowser(options: {
  viewport: { width: number; height: number };
  userAgent?: string;
  isMobile?: boolean;
  deviceScaleFactor?: number;
}): Promise<{ context: BrowserContext; page: Page; close(): Promise<void> }> {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'gnc-pwa-visibility-'));
  const child = spawn(chromium.executablePath(), ['--headless=new', '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', ...(options.userAgent ? [`--user-agent=${options.userAgent}`] : []), 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
  let browser: Browser | undefined;
  const close = async () => {
    await browser?.close();
    if (child.exitCode === null) {
      const stopped = once(child, 'exit');
      child.kill();
      await Promise.race([stopped, new Promise(resolve => { const timer = setTimeout(resolve, 5000); timer.unref(); })]);
    }
    const resolved = path.resolve(profile);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('gnc-pwa-visibility-')) {
      throw new Error('PWA_VISIBILITY_PROFILE_PATH_INVALID');
    }
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  try {
    let port = '';
    for (let count = 0; count < 100 && !port; count++) {
      port = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').then(value => value.split('\n')[0]).catch(() => '');
      if (!port) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!/^\d+$/.test(port)) throw new Error('PWA_VISIBILITY_BROWSER_NOT_READY');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.waitForEvent('page', { timeout: 10000 });
    const session = await context.newCDPSession(page);
    await session.send('Emulation.setDeviceMetricsOverride', { ...options.viewport,
      deviceScaleFactor: options.deviceScaleFactor || 1, mobile: options.isMobile === true });
    return { context, page, close };
  } catch (error) {
    await close();
    throw error;
  }
}
