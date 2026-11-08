import { expect } from '@playwright/test';

export async function waitForExactSeasonSettingsRead(settingsReads = [], timeoutMs = 10_000) {
  await expect.poll(() => settingsReads.slice(), {
    message: 'the interrupted-import read must verify the exact authenticated Current Season settings row',
    timeout: timeoutMs,
  }).toEqual([
    expect.objectContaining({ status: 200, authorization: 'Bearer browser-only-no-real-session' }),
  ]);
}
