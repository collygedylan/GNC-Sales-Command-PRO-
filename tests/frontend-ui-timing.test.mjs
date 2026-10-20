import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { devices } from '@playwright/test';
import { assertFrontendUiTiming, assertRepresentativeQueueRenderTiming, frontendUiTimingLimitMs, isIPhoneSimulatorProject } from './helpers/frontend-ui-timing.mjs';

test('all configured iPhone simulators receive the frontend allowance independent of name, host, or DPR', () => {
  for (const name of ['cache-iphone', 'home-iphone-webkit', 'pwa-phone', 'renamed-project']) {
    for (const deviceScaleFactor of [1, 2, 3]) {
      const project = { name, use: { ...devices['iPhone 13'], deviceScaleFactor } };
      assert.equal(isIPhoneSimulatorProject(project), true);
      assert.equal(frontendUiTimingLimitMs(project), 2000);
    }
  }
  assert.equal(isIPhoneSimulatorProject({ name: 'iphone-chromium', use: {
    browserName: 'chromium', isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 },
  } }), true);
});

test('all non-iPhone device configurations receive the global 2000ms frontend gate', () => {
  for (const use of [devices['Desktop Chrome'], devices['Desktop Safari'], devices['Pixel 7'], devices['iPad Pro 11'],
    {}, { ...devices['iPhone 13'], isMobile: false }, { ...devices['iPhone 13'], hasTouch: false },
    { isMobile: true, hasTouch: true, userAgent: 'Android' }]) {
    const project = { name: 'generic-project', use };
    assert.equal(isIPhoneSimulatorProject(project), false);
    assert.equal(frontendUiTimingLimitMs(project), 2000);
  }
  assert.equal(isIPhoneSimulatorProject({ name: 'cache-iphone', use: {} }), false, 'name alone grants no allowance');
});

test('the assertion uses an inclusive 2000ms boundary for every project, rejecting nonfinite values', () => {
  const assertion = value => ({
    toBeLessThan: limit => assert.ok(value < limit),
    toBeLessThanOrEqual: limit => assert.ok(value <= limit),
  });
  const iphone = { use: devices['iPhone 13'] };
  const desktop = { use: devices['Desktop Chrome'] };
  assertFrontendUiTiming(assertion(2000), iphone);
  assert.throws(() => assertFrontendUiTiming(assertion(2000.001), iphone));
  assert.equal(frontendUiTimingLimitMs(desktop), 2000);
  assertFrontendUiTiming(assertion(2000), desktop, 50);
  assert.throws(() => assertFrontendUiTiming(assertion(2000.001), desktop, 50));
  for (const value of [NaN, Infinity]) {
    assert.throws(() => assertFrontendUiTiming(assertion(value), iphone));
    assert.throws(() => assertFrontendUiTiming(assertion(value), desktop));
  }
});

test('the AV cold-load exception does not relax cached or rendering gates', () => {
  const source = readFileSync(new URL('./av-hydration.e2e.spec.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('expect.soft(preview.firstCardMs).toBeLessThanOrEqual(1000)'));
  assert.ok(source.includes('assertFrontendUiTiming(expect.soft(warm.firstCardMs), test.info().project)'));
  assert.match(source, /assertFrontendUiTiming\(expect\.soft\(Math\.max\(0, \.\.\.preview\.dataRenderDurationsMs, \.\.\.preview\.chunkCallbackDurationsMs,\s*\.\.\.preview\.naturalRenderCycleDurationsMs\)\), test\.info\(\)\.project\)/);
  assert.ok(source.includes('acceptedColdAvFirstCardLimitMs: 1000'));
  assert.ok(source.includes('acceptedAvDomRenderLimitMs: 2000'));
  assert.ok(source.includes('acceptedBackgroundLongTaskLimitMs: 250'));
  for (const phase of ['preview', 'full', 'warm']) {
    assert.ok(source.includes(`expect.soft(Math.max(0, ...${phase}.nonRenderLongTaskDurationsMs)).toBeLessThanOrEqual(250)`));
  }
});

test('representative queue render waiver is inclusive at 2000ms and leaves other UI gates intact', () => {
  const assertion = value => ({ toBeLessThanOrEqual: limit => assert.ok(value <= limit) });
  for (const value of [2000, 614, 800, 1282, 2000]) assertRepresentativeQueueRenderTiming(assertion(value));
  for (const value of [2000.001, NaN, Infinity]) {
    assert.throws(() => assertRepresentativeQueueRenderTiming(assertion(value)));
  }
  assert.throws(() => assertFrontendUiTiming(assertion(2000.001), {}));
  const source = readFileSync(new URL('./que-inventory-parity.e2e.spec.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('assertRepresentativeQueueRenderTiming(expect(Number(renderMs)))'));
  const requestSource = readFileSync(new URL('./request-list-performance.e2e.spec.ts', import.meta.url), 'utf8');
  assert.ok(requestSource.includes('assertRepresentativeQueueRenderTiming(expect.soft(maximumMeasuredMs))'));
  assert.ok(requestSource.includes('acceptedLimitsMs: { pending: 2000, suspend: 2000 }'));
  assert.ok(requestSource.includes('customerLimitMs: 2000, otherModalLimitMs: 2000'));
});
