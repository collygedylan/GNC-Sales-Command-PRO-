import assert from 'node:assert/strict';
import vm from 'node:vm';
import { transformVersionSurface } from '../../scripts/sync-all-version-surfaces.mjs';
import { resolveChunkRenderPacing, shouldAuditRetainedChunkPage } from '../../src/ui/chunk-render-pacing.js';
import { waitForPublishedHydration } from './release-smoke-hydration-settle.mjs';
import { waitForExactSeasonSettingsRead } from './release-smoke-settings-evidence.mjs';

export function invariant556({ read }) {
  const config = read('playwright.release-smoke.config.ts');
  const runner = read('scripts/run-release-smoke.mjs');
  assert.match(config, /fullyParallel:\s*false[\s\S]*workers:\s*1[\s\S]*retries:\s*1/);
  assert.ok(config.indexOf("name: 'iphone-webkit'") < config.indexOf("name: 'desktop-chromium'"));
  assert.match(runner, /RELEASE_SMOKE_WORKERS = 1[\s\S]*RELEASE_SMOKE_PROCESS_TIMEOUT_MS = 900_000[\s\S]*--retries=1/);
}

export function invariant557() {
  const pacing = resolveChunkRenderPacing(37, 3.5, { minBatch: 4 },
    { liveGestureActive: true, touchConstrained: true });
  assert.equal(pacing.batchTarget, 37);
  assert.equal(pacing.frameDelayMs, 0);
}

export function invariant558() {
  assert.equal(shouldAuditRetainedChunkPage(false), false);
  assert.equal(shouldAuditRetainedChunkPage(true), true);
}

export async function invariant559() {
  let attempts = 0;
  const loaded = await waitForPublishedHydration(async () => ++attempts >= 3,
    () => ({ state: attempts >= 3 ? 'Published data' : 'Syncing' }), async () => {}, { timeoutMs: 250 });
  assert.equal(loaded, true);
  assert.equal(attempts, 3);
  const reads = [];
  setTimeout(() => reads.push({ status: 200, authorization: 'Bearer browser-only-no-real-session' }), 5);
  await waitForExactSeasonSettingsRead(reads, 250);
  assert.equal(reads.length, 1);
}

export function invariant560({ read }) {
  const runtime = read('assets/app-runtime.js');
  const moduleSource = read('src/views/suspend-tag-page.js');
  const index = read('index.html');
  const start = runtime.indexOf('function renderSuspendTagPagedCards');
  const end = runtime.indexOf('function shouldBumpRequestMainBeforeRender', start);
  const adapter = runtime.slice(start, end);
  assert.match(adapter, /return globalThis\.renderSuspendTagPage\(/);
  assert.doesNotMatch(adapter, /__suspendPageStage|renderMarkupChunkedByKey\(/);
  assert.ok(adapter.split(/\r?\n/).length <= 60);
  assert.match(moduleSource, /__suspendPageStage[\s\S]*__suspendPagePublicationReceipt/);
  assert.ok(index.indexOf('assets/suspend-tag-page.js') < index.indexOf('assets/app-runtime.js'));
}

export function invariant561({ read }) {
  const context = vm.createContext({});
  vm.runInContext(read('assets/chunk-render-pacing.js'), context);
  vm.runInContext(read('assets/suspend-tag-page.js'), context);
  assert.equal(context.resolveChunkRenderPacing(48, 5, {}, {}).batchTarget, 48);
  assert.equal(typeof context.renderSuspendTagPage, 'function');
  const runtime = read('assets/app-runtime.js');
  assert.match(runtime, /globalThis\.resolveChunkRenderPacing\(/);
  assert.match(runtime, /shouldAuditRetainedChunkPage: globalThis\.shouldAuditRetainedChunkPage/);
  assert.match(runtime, /globalThis\.renderSuspendTagPage\(/);
}

export function invariant562({ read }) {
  const source = read('docs/architecture/agdata-symbol-index.json');
  assert.equal(transformVersionSurface('docs/architecture/agdata-symbol-index.json', source,
    '3.0.44', '3.0.44'), source);
  const compact = '{\n  "release": "AgData v3.0.37",\n  "assets": ["a", "b"]\n}\n';
  const updated = transformVersionSurface('docs/architecture/agdata-symbol-index.json', compact,
    '3.0.44', '3.0.37');
  assert.equal(updated, compact.replace('3.0.37', '3.0.44'));
}
