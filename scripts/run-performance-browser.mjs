import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { compareBenchmarks, parseBenchmarkManifest, percentile } from '../services/performanceBaseline.ts';
import { startReleaseTestServer } from './serve-release-tests.mjs';
import { verifyReleaseArtifact } from './release-artifact.mjs';
import { installPerformanceFixture, openPerformanceView, returnPerformanceHome } from './performance-browser-fixture.mjs';
import { drainPerformanceResponseBodies } from './performance-response-drain.mjs';

const root = process.cwd();
const manifest = parseBenchmarkManifest(JSON.parse(await readFile(path.join(root, 'performance/baseline.json'), 'utf8')));
const baselineSite = path.resolve(process.env.PERFORMANCE_BASELINE_SITE || path.join('.gnc-local', `performance-baseline-${manifest.baselineCommit}`, '_site'));
const candidateSite = path.resolve(process.env.GNC_LOCAL_SITE_DIR || '_site');
const output = path.join(root, 'artifacts', 'performance');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const failures = [];
const reports = [];

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
async function measure(page, app, view, totals) {
  await settle(page);
  await drainPerformanceResponseBodies(totals);
  const before = { reads: totals.reads, bytes: totals.bytes };
  await page.evaluate(() => { window.__phase6Metrics = { longTaskMs: 0, domRemovals: 0 }; });
  const started = performance.now();
  await openPerformanceView(page, app, view);
  await settle(page);
  const duration = performance.now() - started;
  await drainPerformanceResponseBodies(totals);
  if (totals.errors.length) throw new Error(`PERFORMANCE_RESPONSE_MEASUREMENT_FAILED:${totals.errors.join(',')}`);
  const routeReads = totals.reads - before.reads;
  const routeBytes = totals.bytes - before.bytes;
  const evidence = await page.evaluate(() => window.__phase6Metrics);
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
  return { duration, reads: routeReads, bytes: routeBytes, ...evidence, scrollFrameP95 };
}
async function benchmark(site, info, profile, app) {
  const server = await startReleaseTestServer({ siteDir: site, port: 0 });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const samples = new Map();
  const add = (id, kind, value) => {
    if (!samples.has(id)) samples.set(id, { id, kind, samples: [] });
    samples.get(id).samples.push(value);
  };
  const deferred = [];
  const initialExecutableJsBytes = [];
  try {
    for (let iteration = 0; iteration < manifest.coldSamples; iteration++) {
      const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, baseURL: origin, serviceWorkers: 'block' });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      const totals = { reads: 0, bytes: 0, scriptBytes: 0, pending: [], errors: [] };
      page.on('request', request => {
        if (request.method() !== 'OPTIONS' && /\/(?:rest|functions)\/v1\//.test(request.url())) totals.reads++;
      });
      page.on('response', response => {
        const request = response.request();
        if (request.method() === 'OPTIONS') return;
        const api = /\/(?:rest|functions)\/v1\//.test(response.url());
        if (!api && request.resourceType() !== 'script') return;
        const pending = response.body().then(body => {
          if (api) totals.bytes += body.length;
          else totals.scriptBytes += body.length;
        }).catch(() => { totals.errors.push(new URL(response.url()).pathname); });
        totals.pending.push(pending);
      });
      await page.addInitScript(() => {
        window.__phase6Metrics = { longTaskMs: 0, domRemovals: 0 };
        if (PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver(entries => {
          for (const entry of entries.getEntries()) window.__phase6Metrics.longTaskMs += entry.duration;
        }).observe({ type: 'longtask' });
        document.addEventListener('DOMContentLoaded', () => new MutationObserver(entries => {
          for (const entry of entries) {
            if (entry.target instanceof Element && entry.target.closest('#drive-content, #request-content, .request-list, .drive-item-list')) {
              window.__phase6Metrics.domRemovals += entry.removedNodes.length;
            }
          }
        }).observe(document.body, { childList: true, subtree: true }), { once: true });
      });
      try {
        await installPerformanceFixture(page, origin, app);
        await settle(page);
        await drainPerformanceResponseBodies(totals);
        if (totals.errors.length) throw new Error('PERFORMANCE_INITIAL_RESPONSE_MEASUREMENT_FAILED');
        const initialBytes = totals.scriptBytes;
        initialExecutableJsBytes.push(initialBytes);
        add('initial-api-reads', 'count', totals.reads);
        add('initial-api-bytes', 'bytes', totals.bytes);
        for (const view of ['request', 'drive']) {
          const cold = await measure(page, app, view, totals);
          for (const [key, value] of Object.entries(cold)) add(`${view}.cold.${key}`, ['duration', 'longTaskMs', 'scrollFrameP95'].includes(key) ? 'duration' : key === 'bytes' ? 'bytes' : 'count', value);
          await returnPerformanceHome(page, app);
          for (let warm = 0; warm < manifest.warmSamples / manifest.coldSamples; warm++) {
            const value = await measure(page, app, view, totals);
            for (const [key, sample] of Object.entries(value)) add(`${view}.warm.${key}`, ['duration', 'longTaskMs', 'scrollFrameP95'].includes(key) ? 'duration' : key === 'bytes' ? 'bytes' : 'count', sample);
            await returnPerformanceHome(page, app);
          }
        }
        deferred.push(totals.scriptBytes - initialBytes);
      } finally { await context.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
  const report = { schemaVersion: 1, commit: info.commit, baselineCommit: manifest.baselineCommit, artifactDigest: info.digest,
    fixtureVersion: manifest.fixtureVersion, browser: `chromium-${browser.version()}`, viewport: { width: profile.width, height: profile.height },
    method: `${app}:serial-cold-context-and-warm-route-v1;service-workers-blocked`, metrics: [...samples.values()], initialExecutableJsBytes };
  // Background SW precache is deliberately measured separately by offline tests.
  reports.push({ ...report, profile: profile.id, app, deferredScriptBytes: deferred });
  return report;
}
try {
  const baseline = await sealInfo(baselineSite), candidate = await sealInfo(candidateSite);
  if (baseline.commit !== manifest.baselineCommit) throw new Error('PERFORMANCE_BASELINE_COMMIT_MISMATCH');
  for (const profile of manifest.profiles) for (const app of ['live', 'v2']) {
    // Alternate execution order by profile to avoid always rewarding warm host caches.
    const reverse = profile.id === 'tablet';
    let previous, current;
    if (reverse) { current = await benchmark(candidateSite, candidate, profile, app); previous = await benchmark(baselineSite, baseline, profile, app); }
    else { previous = await benchmark(baselineSite, baseline, profile, app); current = await benchmark(candidateSite, candidate, profile, app); }
    failures.push(...compareBenchmarks(manifest, previous, current).map(message => `${app}/${profile.id}: ${message}`));
    console.log(`PERFORMANCE_MEASURED ${app}/${profile.id}: initial JS ${percentile(previous.initialExecutableJsBytes, 0.5)} -> ${percentile(current.initialExecutableJsBytes, 0.5)} bytes`);
  }
} finally {
  await browser.close();
  await writeFile(path.join(output, 'browser.json'), JSON.stringify({ manifest, reports, failures }, null, 2) + '\n');
}
if (failures.length) throw new Error(`PERFORMANCE_REGRESSION:\n${failures.join('\n')}`);
