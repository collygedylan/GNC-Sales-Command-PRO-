import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

function installToolingChromium() {
  const cli = fileURLToPath(new URL('../node_modules/playwright/cli.js', import.meta.url));
  execFileSync(process.execPath, [cli, 'install', 'chromium'], {
    windowsHide: true, timeout: 90000, stdio: 'pipe', maxBuffer: 1024 * 1024,
  });
}

export async function prepareToolingBrowser({
  exists = existsSync, install = installToolingChromium,
  executable = chromium.executablePath(), print = console.log,
} = {}) {
  if (exists(executable)) return;
  print('Preparing the pinned Chromium dependency for release verification.');
  await install();
  if (!exists(executable)) throw new Error('TOOLING_CHROMIUM_EXECUTABLE_MISSING');
}
