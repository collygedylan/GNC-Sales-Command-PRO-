import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { compareBenchmarks, parseBenchmarkManifest, percentile } from '../services/performanceBaseline.ts';
import { startReleaseTestServer } from './serve-release-tests.mjs';
import { verifyReleaseArtifact } from './release-artifact.mjs';
import { installPerformanceFixture, openPerformanceView, returnPerformanceHome, waitForPerformanceViewSettlement,
  waitForPerformancePollWindow, PERFORMANCE_API_QUIET_MS } from './performance-browser-fixture.mjs';
import { installPerformanceDomRemovalObserver } from './performance-dom-observer.mjs';
import { installPerformanceLongTaskObserver } from './performance-longtask-observer.mjs';
import { attachPerformanceResponseTracker, drainPerformanceResponseBodies, safePerformanceApiDiagnostic, settlePerformanceApiBoundary } from './performance-response-drain.mjs';
import { installPerformanceRandomFixture, performanceRandomSeed } from './performance-random-fixture.mjs';
import { runPerformanceBrowserPairs } from './performance-browser-pairs.mjs';

const root = process.cwd();
const manifest = parseBenchmarkManifest(JSON.parse(await readFile(path.join(root, 'performance/baseline.json'), 'utf8')));
const baselineSite = path.resolve(process.env.PERFORMANCE_BASELINE_SITE || path.join('.gnc-local', `performance-baseline-${manifest.baselineCommit}`, '_site'));
const candidateSite = path.resolve(process.env.GNC_LOCAL_SITE_DIR || '_site');
const output = path.join(root, 'artifacts', 'performance');
await mkdir(output, { recursive: true });
const failures = [];
const reports = [];
const contextReports = [];
const contextSchedules = [];

async function sealInfo(site) {
  const bytes = await readFile(path.join(site, 'release-manifest.json'));
  const seal = JSON.parse(bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  await verifyReleaseArtifact(site, { ...process.env, EXPECTED_RELEASE_COMMIT: seal.commit, EXPECTED_RELEASE_DIGEST: digest });
  return { commit: seal.commit, digest };
}
async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
function classifyApiTraffic(requests) {
  const reads = [], writes = [], other = [];
  let readBytes = 0, writeBytes = 0, otherBytes = 0;
  for (const request of requests) {
    if (request.operation === 'rpc:report_app_health_event') {
      writes.push(request); writeBytes += request.bytes;
    } else if (request.operation) {
      reads.push(request); readBytes += request.bytes;
    } else {
      other.push(request); otherBytes += request.bytes;
    }
  }
  return { reads, writes, other, readBytes, writeBytes, otherBytes };
}
async function measure(page, app, view, totals, fixtureControl, diagnosticCursor) {
  if (app === 'live') await waitForPerformancePollWindow(page);
  await settle(page);
  const startIndex = await settlePerformanceApiBoundary(totals, fixtureControl);
  const preludeRequests = totals.apiRequests.slice(diagnosticCursor, startIndex);
  const sampleStart = await page.evaluate(viewId => {
    window.__phase6Metrics = { viewId };
    const dom = window.__phase6DomRemovalObserver;
    if (!dom) throw new Error('PERFORMANCE_DOM_OBSERVER_MISSING');
    dom.reset(viewId);
    const longTasks = window.__phase6LongTaskObserver;
    if (!longTasks) throw new Error('PERFORMANCE_LONGTASK_OBSERVER_MISSING');
    const startedAt = longTasks.begin();
    window.__phase6Metrics.sampleStart = startedAt;
    return startedAt;
  }, view);
  const started = performance.now();
  await openPerformanceView(page, app, view);
  await settle(page);
  const duration = performance.now() - started;
  // Keep first-visible timing separate from attribution of deferred route work.
  // Existing interaction-aware timers can start reads/renders after API silence.
  await waitForPerformanceViewSettlement(page, app, view);
  const endIndex = await settlePerformanceApiBoundary(totals, fixtureControl);
  const routeRequests = totals.apiRequests.slice(startIndex, endIndex);
  const routeErrors = [...totals.errors, ...routeRequests.map(request => request.error).filter(Boolean)];
  if (routeErrors.length) throw new Error(`PERFORMANCE_RESPONSE_MEASUREMENT_FAILED:${routeErrors.join(',')}`);
  const classified = classifyApiTraffic(routeRequests);
  const evidence = await page.evaluate(({ viewId, startedAt }) => ({
    ...window.__phase6LongTaskObserver.finish(startedAt),
    ...window.__phase6DomRemovalObserver.snapshot(viewId)
  }), { viewId: view, startedAt: sampleStart });
  const scrollFrameP95 = await page.evaluate(async appId => {
    const scroller = document.querySelector(appId === 'v2' ? 'main.main-scroll' : '#main-scroll-area');
    if (!(scroller instanceof HTMLElement)) throw new Error('PERFORMANCE_SCROLL_HOST_MISSING');
    const gaps = [], start = scroller.scrollTop, distance = Math.min(600, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
    let previous = performance.now();
    for (let frame = 0; frame < 16; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const now = performance.now(); gaps.push(now - previous); previous = now;
      scroller.scrollTop = distance * frame / 15;
    }
    scroller.scrollTop = start;
    return gaps.sort((a, b) => a - b)[Math.ceil(gaps.length * 0.95) - 1];
  }, app);
  await drainPerformanceResponseBodies(totals);
  if (totals.errors.length) throw new Error(`PERFORMANCE_RESPONSE_MEASUREMENT_FAILED:${totals.errors.join(',')}`);
  return { duration, reads: classified.reads.length, bytes: classified.readBytes,
    writes: classified.writes.length, writeBytes: classified.writeBytes,
    otherRequests: classified.other.length, otherBytes: classified.otherBytes,
    canceledReads: routeRequests.filter(request => request.canceled).length, requestRecords: routeRequests, preludeRequests,
    boundaryStartIndex: startIndex, boundaryEndIndex: endIndex, ...evidence, scrollFrameP95 };
}
async function benchmark(site, info, profile, app, iteration) {
  const server = await startReleaseTestServer({ siteDir: site, port: 0 });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  let browserVersion;
  const samples = new Map();
  const add = (id, kind, value) => {
    if (!samples.has(id)) samples.set(id, { id, kind, samples: [] });
    samples.get(id).samples.push(value);
  };
  const deferred = [];
  const initialExecutableJsBytes = [];
  const cancellationDiagnostics = [];
  const apiTrafficDiagnostics = [];
  const randomDiagnostics = [];
  const recordApiPhase = (indices, phase, requests) => {
    for (const request of requests) {
      if (indices.has(request.index)) throw new Error('PERFORMANCE_API_DIAGNOSTIC_DUPLICATE');
      indices.add(request.index);
    }
    const classified = classifyApiTraffic(requests);
    apiTrafficDiagnostics.push({ phase,
      reads: classified.reads.map(safePerformanceApiDiagnostic),
      writes: classified.writes.map(safePerformanceApiDiagnostic),
      other: classified.other.map(safePerformanceApiDiagnostic),
      requestCount: requests.length,
      responseBytes: requests.reduce((sum, request) => sum + request.bytes, 0) });
  };
  try {
    // Each cold context gets a new Chromium process; warm visits stay inside it.
    // This prevents a previous revision's process caches/heap from carrying over.
    browser = await chromium.launch();
    browserVersion = browser.version();
    {
      const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, baseURL: origin, serviceWorkers: 'block' });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      const seed = performanceRandomSeed(profile.id, app, iteration);
      await page.addInitScript({ content: `(${installPerformanceRandomFixture.toString()})(${seed});` });
      const totals = { scriptBytes: 0, apiRequests: [], pending: [], errors: [] };
      const apiDiagnosticIndices = new Set();
      let apiDiagnosticCursor = 0;
      attachPerformanceResponseTracker(page, totals);
      await page.addInitScript({ content: `(${installPerformanceDomRemovalObserver.toString()})(globalThis);` });
      await page.addInitScript({ content: `(${installPerformanceLongTaskObserver.toString()})(globalThis);` });
      await page.addInitScript(() => { window.__phase6Metrics = {}; });
      try {
        const fixtureControl = await installPerformanceFixture(page, origin, app);
        const recordApiTransition = async phase => {
          const endIndex = await settlePerformanceApiBoundary(totals, fixtureControl);
          const requests = totals.apiRequests.slice(apiDiagnosticCursor, endIndex);
          recordApiPhase(apiDiagnosticIndices, phase, requests);
          apiDiagnosticCursor = endIndex;
        };
        await settle(page);
        const initialEndIndex = await settlePerformanceApiBoundary(totals, fixtureControl);
        const initialRequests = totals.apiRequests.slice(0, initialEndIndex);
        const initialApiErrors = initialRequests.map(request => request.error).filter(Boolean);
        if (totals.errors.length || initialApiErrors.length) {
          throw new Error(`PERFORMANCE_INITIAL_RESPONSE_MEASUREMENT_FAILED:${[...totals.errors, ...initialApiErrors].join(',')}`);
        }
        const initialBytes = totals.scriptBytes;
        initialExecutableJsBytes.push(initialBytes);
        cancellationDiagnostics.push({ view: 'home', phase: 'initial', canceledApiReads: initialRequests.filter(request => request.canceled).length });
        add('initial-api-reads', 'count', initialRequests.length);
        add('initial-api-bytes', 'bytes', initialRequests.reduce((sum, request) => sum + request.bytes, 0));
        recordApiPhase(apiDiagnosticIndices, 'initial', initialRequests);
        apiDiagnosticCursor = initialEndIndex;
        for (const view of ['request', 'drive']) {
          const cold = await measure(page, app, view, totals, fixtureControl, apiDiagnosticCursor);
          recordApiPhase(apiDiagnosticIndices, `${view}.before-cold`, cold.preludeRequests);
          recordApiPhase(apiDiagnosticIndices, `${view}.cold`, cold.requestRecords);
          apiDiagnosticCursor = cold.boundaryEndIndex;
          cancellationDiagnostics.push({ view, phase: 'cold', canceledApiReads: cold.canceledReads });
          for (const [key, value] of Object.entries(cold)) {
            if (key === 'canceledReads' || key === 'requestRecords' || key === 'preludeRequests' || key === 'viewId'
              || key === 'boundaryStartIndex' || key === 'boundaryEndIndex') continue;
            add(`${view}.cold.${key}`, ['duration', 'longTaskMs', 'scrollFrameP95'].includes(key) ? 'duration' : /bytes$/i.test(key) ? 'bytes' : 'count', value);
          }
          await returnPerformanceHome(page, app);
          await recordApiTransition(`${view}.home-after-cold`);
          for (let warm = 0; warm < manifest.warmSamples / manifest.coldSamples; warm++) {
            const value = await measure(page, app, view, totals, fixtureControl, apiDiagnosticCursor);
            recordApiPhase(apiDiagnosticIndices, `${view}.before-warm-${warm + 1}`, value.preludeRequests);
            recordApiPhase(apiDiagnosticIndices, `${view}.warm-${warm + 1}`, value.requestRecords);
            apiDiagnosticCursor = value.boundaryEndIndex;
            cancellationDiagnostics.push({ view, phase: `warm-${warm + 1}`, canceledApiReads: value.canceledReads });
            for (const [key, sample] of Object.entries(value)) {
              if (key === 'canceledReads' || key === 'requestRecords' || key === 'preludeRequests' || key === 'viewId'
                || key === 'boundaryStartIndex' || key === 'boundaryEndIndex') continue;
              add(`${view}.warm.${key}`, ['duration', 'longTaskMs', 'scrollFrameP95'].includes(key) ? 'duration' : /bytes$/i.test(key) ? 'bytes' : 'count', sample);
            }
            await returnPerformanceHome(page, app);
            await recordApiTransition(`${view}.home-after-warm-${warm + 1}`);
          }
        }
        const finalEndIndex = await settlePerformanceApiBoundary(totals, fixtureControl);
        recordApiPhase(apiDiagnosticIndices, 'final-settle', totals.apiRequests.slice(apiDiagnosticCursor, finalEndIndex));
        apiDiagnosticCursor = finalEndIndex;
        const finalApiErrors = totals.apiRequests.map(request => request.error).filter(Boolean);
        if (totals.errors.length || finalApiErrors.length) {
          throw new Error(`PERFORMANCE_FINAL_RESPONSE_MEASUREMENT_FAILED:${[...totals.errors, ...finalApiErrors].join(',')}`);
        }
        cancellationDiagnostics.push({ view: 'all', phase: 'final-drain', canceledApiReads: totals.apiRequests.filter(request => request.canceled).length });
        if (apiDiagnosticIndices.size !== totals.apiRequests.length) throw new Error('PERFORMANCE_API_DIAGNOSTIC_COVERAGE_MISMATCH');
        const fullTraffic = classifyApiTraffic(totals.apiRequests);
        add('all-api-reads', 'count', fullTraffic.reads.length);
        add('all-api-writes', 'count', fullTraffic.writes.length);
        add('all-api-other', 'count', fullTraffic.other.length);
        add('all-api-requests', 'count', totals.apiRequests.length);
        add('all-api-bytes', 'bytes', totals.apiRequests.reduce((sum, request) => sum + request.bytes, 0));
        deferred.push(totals.scriptBytes - initialBytes);
        randomDiagnostics.push(await page.evaluate(() => globalThis.__phase6RandomFixture.getState()));
      } finally { await context.close(); }
    }
  } finally {
    try { if (browser) await browser.close(); }
    finally { await new Promise(resolve => server.close(resolve)); }
  }
  const report = { schemaVersion: 1, commit: info.commit, baselineCommit: manifest.baselineCommit, artifactDigest: info.digest,
    fixtureVersion: manifest.fixtureVersion, browser: `chromium-${browserVersion}`, viewport: { width: profile.width, height: profile.height },
    method: `${app}:adjacent-counterbalanced-cold-process-and-warm-route-v9;service-workers-blocked;seeded-mulberry32-v1;healthSampling:${app === 'live' ? 'mulberry32-event-area-reason-v1' : 'not-applicable'};all-api-quiet-${PERFORMANCE_API_QUIET_MS}ms;route-settlement-${app === 'live' ? 'cold-session-restore-shell-dataset-render-queues-api-idle-and-unmodified-poll-headroom-12s' : 'visible-content'};stable-route-root-dom-removals;traffic-read-write-classification-v1`, metrics: [...samples.values()], initialExecutableJsBytes };
  // Background SW precache is deliberately measured separately by offline tests.
  const complete = { ...report, profile: profile.id, app, deferredScriptBytes: deferred, cancellationDiagnostics, apiTrafficDiagnostics, randomDiagnostics };
  contextReports.push({ ...complete, iteration });
  return complete;
}

try {
  const baseline = await sealInfo(baselineSite), candidate = await sealInfo(candidateSite);
  if (baseline.commit !== manifest.baselineCommit) throw new Error('PERFORMANCE_BASELINE_COMMIT_MISMATCH');
  for (const profile of manifest.profiles) for (const app of ['live', 'v2']) {
    const pair = await runPerformanceBrowserPairs(manifest, (revision, iteration) => benchmark(
      revision === 'baseline' ? baselineSite : candidateSite,
      revision === 'baseline' ? baseline : candidate, profile, app, iteration), { reverse: profile.id === 'tablet' });
    const previous = pair.baseline, current = pair.candidate;
    reports.push(previous, current);
    contextSchedules.push({ profile: profile.id, app, schedule: pair.schedule });
    failures.push(...compareBenchmarks(manifest, previous, current).map(message => `${app}/${profile.id}: ${message}`));
    console.log(`PERFORMANCE_MEASURED ${app}/${profile.id}: initial JS ${percentile(previous.initialExecutableJsBytes, 0.5)} -> ${percentile(current.initialExecutableJsBytes, 0.5)} bytes`);
  }
} finally {
  await writeFile(path.join(output, 'browser.json'), JSON.stringify({ manifest, reports, contextReports, contextSchedules, failures }, null, 2) + '\n');
}
if (failures.length) throw new Error(`PERFORMANCE_REGRESSION:\n${failures.join('\n')}`);
