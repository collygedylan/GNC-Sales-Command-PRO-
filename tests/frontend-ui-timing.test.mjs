import assert from 'node:assert/strict';
import test from 'node:test';
import { devices } from '@playwright/test';
import { assertFrontendUiTiming, frontendUiTimingLimitMs, isIPhoneSimulatorProject } from './helpers/frontend-ui-timing.mjs';

test('all configured iPhone simulators receive the frontend allowance independent of name, host, or DPR', () => {
  for (const name of ['cache-iphone', 'home-iphone-webkit', 'pwa-phone', 'renamed-project']) {
    for (const deviceScaleFactor of [1, 2, 3]) {
      const project = { name, use: { ...devices['iPhone 13'], deviceScaleFactor } };
      assert.equal(isIPhoneSimulatorProject(project), true);
      assert.equal(frontendUiTimingLimitMs(project), 400);
    }
  }
  assert.equal(isIPhoneSimulatorProject({ name: 'iphone-chromium', use: {
    browserName: 'chromium', isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 },
  } }), true);
});

test('desktop, Android, iPad and incomplete or contradictory device configurations keep the strict gate', () => {
  for (const use of [devices['Desktop Chrome'], devices['Desktop Safari'], devices['Pixel 7'], devices['iPad Pro 11'],
    {}, { ...devices['iPhone 13'], isMobile: false }, { ...devices['iPhone 13'], hasTouch: false },
    { isMobile: true, hasTouch: true, userAgent: 'Android' }]) {
    const project = { name: 'generic-project', use };
    assert.equal(isIPhoneSimulatorProject(project), false);
    assert.equal(frontendUiTimingLimitMs(project), 100);
  }
  assert.equal(isIPhoneSimulatorProject({ name: 'cache-iphone', use: {} }), false, 'name alone grants no allowance');
});

test('the assertion preserves inclusive 400ms and exclusive 100ms boundaries, rejecting nonfinite values', () => {
  const assertion = value => ({
    toBeLessThan: limit => assert.ok(value < limit),
    toBeLessThanOrEqual: limit => assert.ok(value <= limit),
  });
  const iphone = { use: devices['iPhone 13'] };
  const desktop = { use: devices['Desktop Chrome'] };
  assertFrontendUiTiming(assertion(400), iphone);
  assert.throws(() => assertFrontendUiTiming(assertion(400.001), iphone));
  assertFrontendUiTiming(assertion(99.999), desktop);
  assert.throws(() => assertFrontendUiTiming(assertion(100), desktop));
  assert.throws(() => assertFrontendUiTiming(assertion(50), desktop, 50), 'stricter existing desktop gates remain strict');
  assertFrontendUiTiming(assertion(400), iphone, 50);
  for (const value of [NaN, Infinity]) {
    assert.throws(() => assertFrontendUiTiming(assertion(value), iphone));
    assert.throws(() => assertFrontendUiTiming(assertion(value), desktop));
  }
});
