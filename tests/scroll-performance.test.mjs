import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const html = read('index.html');
const pilot = read('assets/ops-precision-pilot.js');
const playwrightConfig = read('playwright.config.ts');

test('the shared scroll path has no universal restyle or synchronous sticky geometry scan', () => {
  const guardrailStyles = html.slice(
    html.indexOf('<style id="app-performance-guardrails">'),
    html.indexOf('</style>', html.indexOf('<style id="app-performance-guardrails">'))
  );
  assert.doesNotMatch(
    guardrailStyles,
    /body\.(?:performance-scroll-active|mobile-text-entry-active|mobile-filter-entry-active|gnc-perf-adaptive-hard)\s+\*/
  );

  const stickyInitializer = html.slice(
    html.indexOf('function initializeStickyRailOffsetSync'),
    html.indexOf('let horizontalViewportClampInitialized')
  );
  const mainScrollHandler = stickyInitializer.slice(
    stickyInitializer.indexOf("mainScrollArea.addEventListener('scroll'"),
    stickyInitializer.indexOf("if (window.visualViewport")
  );
  assert.match(mainScrollHandler, /if \(!keyboardSensitive\) return;/);
  assert.match(mainScrollHandler, /scheduleDeferredChromeSyncTask\('sticky-rail-main-scroll-settled'/);
  assert.doesNotMatch(mainScrollHandler, /scheduleStickyRailOffsetSync\('main-scroll', false\)/);
  assert.doesNotMatch(mainScrollHandler, /syncIosFixedTopChromeMetrics\('main-scroll'\);/);
});

test('the hosted browser suite measures scrolling and realtime decorations stay subtree-scoped', () => {
  assert.match(playwrightConfig, /scroll-performance\\\.e2e/);
  assert.match(pilot, /new MutationObserver\(\(records\) =>/);
  assert.match(pilot, /record\.addedNodes/);
  assert.match(pilot, /schedulePremiumDecorations\(node\)/);
  assert.match(pilot, /requestIdleCallback\(decorateRecordCollections, \{ timeout: 220 \}\)/);
  assert.doesNotMatch(pilot, /new MutationObserver\(\(\) => \{\s*schedulePremiumDecorations\(\);/);
});
