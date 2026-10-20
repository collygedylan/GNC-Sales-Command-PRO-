import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sourceDigest, siteDigest } from './local-validation-evidence.mjs';
import { verifyReleaseArtifact } from './release-artifact.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(code); };

export function assertReleaseAssetReferences(siteDir) {
  const html = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');
  const references = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map(match => match[1].split(/[?#]/)[0]).filter(value => /^(?:\.\/)?assets\//.test(value));
  for (const relative of new Set(references)) {
    if (!fs.existsSync(path.join(siteDir, relative))) fail(`RELEASE_SMOKE_ASSET_MISSING:${relative}`);
  }
}

function git(args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false, windowsHide: true });
}

function collectResults(suites, output = [], inheritedProject = '') {
  for (const suite of suites || []) {
    const project = suite.title || inheritedProject;
    for (const spec of suite.specs || []) for (const test of spec.tests || []) {
      const result = test.results?.at(-1);
      output.push({ title: spec.title, project: test.projectName || project, status: result?.status || 'missing',
        attachments: result?.attachments || [] });
    }
    collectResults(suite.suites, output, project);
  }
  return output;
}

export async function runReleaseSmoke({ env = process.env, print = console.log } = {}) {
  const startedAt = new Date().toISOString();
  const siteDirValue = String(env.RELEASE_SMOKE_SITE_DIR || '').trim();
  const expectedCommit = String(env.EXPECTED_RELEASE_COMMIT || '').trim().toLowerCase();
  const expectedArtifact = String(env.EXPECTED_RELEASE_DIGEST || '').trim().toLowerCase();
  const expectedSource = String(env.RELEASE_SMOKE_SOURCE_DIGEST || '').trim().toLowerCase();
  if (!siteDirValue || !/^[a-f0-9]{40}$/.test(expectedCommit)
    || !/^[a-f0-9]{64}$/.test(expectedArtifact) || !/^[a-f0-9]{64}$/.test(expectedSource)) {
    fail('RELEASE_SMOKE_EXPECTED_SITE_COMMIT_ARTIFACT_AND_SOURCE_DIGEST_REQUIRED');
  }
  const siteDir = path.resolve(root, siteDirValue);
  const relativeSite = path.relative(root, siteDir);
  if (!relativeSite || relativeSite === '..' || relativeSite.startsWith(`..${path.sep}`) || path.isAbsolute(relativeSite)) {
    fail('RELEASE_SMOKE_SITE_MUST_BE_IN_WORKSPACE');
  }
  const head = git(['rev-parse', 'HEAD']);
  if (head.status !== 0 || head.stdout.trim() !== expectedCommit) fail('RELEASE_SMOKE_COMMIT_MISMATCH');
  const currentSourceDigest = sourceDigest(root);
  if (currentSourceDigest !== expectedSource) fail('RELEASE_SMOKE_SOURCE_DIGEST_MISMATCH');
  const artifact = await verifyReleaseArtifact(siteDir, {
    ...env,
    CI: '1',
    EXPECTED_RELEASE_COMMIT: expectedCommit,
    EXPECTED_RELEASE_DIGEST: expectedArtifact,
  });
  assertReleaseAssetReferences(siteDir);
  const currentSiteDigest = siteDigest(siteDir);
  const outputDir = path.join(root, '.gnc-local', 'release-smoke', artifact.release.replaceAll(/[^a-z0-9]+/gi, '-').toLowerCase(), expectedCommit.slice(0, 12), startedAt.replaceAll(/[^0-9]/g, ''));
  fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, 'report.json');
  const logPath = path.join(outputDir, 'playwright.log');
  const report = {
    schemaVersion: 'gnc-release-smoke-v1', status: 'running', startedAt,
    release: artifact.release, commit: artifact.commit, artifactDigest: artifact.digest,
    sourceDigest: currentSourceDigest, siteDigest: currentSiteDigest,
    productionWrites: false, realEmailsSent: false,
    browserProjects: ['desktop-chromium', 'android-chromium', 'iphone-webkit'],
    playwright: { status: 'not-started', resultsPath: path.join(outputDir, 'results.json'), logPath },
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const logFd = fs.openSync(logPath, 'w');
  let result;
  try {
    result = spawnSync(process.execPath, [path.join(root, 'node_modules', '@playwright', 'test', 'cli.js'),
      'test', '--config', path.join(root, 'playwright.release-smoke.config.ts'), '--workers=3', '--retries=0'], {
      cwd: root, shell: false, windowsHide: true, timeout: 300_000,
      stdio: ['ignore', logFd, logFd],
      env: { ...env, CI: '1', RELEASE_SMOKE_SITE_DIR: siteDir, RELEASE_SMOKE_OUTPUT_DIR: outputDir },
    });
  } finally { fs.closeSync(logFd); }
  report.playwright = { ...report.playwright, status: result.error ? 'error' : result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status, error: result.error?.code || result.error?.message || null };
  if (result.status === 0 && !result.error) {
    const resultsPath = report.playwright.resultsPath;
    const bytes = fs.readFileSync(resultsPath);
    const resultsJson = JSON.parse(bytes.toString('utf8'));
    const results = collectResults(resultsJson.suites);
    const projects = new Set(results.filter(row => row.status === 'passed').map(row => row.project));
    if (results.length < 6 || results.some(row => row.status !== 'passed')
      || report.browserProjects.some(project => !projects.has(project))) {
      report.playwright.status = 'evidence-invalid';
      report.playwright.validationError = 'RELEASE_SMOKE_BROWSER_MATRIX_INCOMPLETE';
    } else {
      const attachmentJson = attachment => {
        if (typeof attachment.body === 'string') return Buffer.from(attachment.body, 'base64').toString('utf8');
        if (typeof attachment.path === 'string') return fs.readFileSync(path.resolve(root, attachment.path), 'utf8');
        return '';
      };
      const primaryTests = results.filter(row => row.attachments.some(attachment => attachment.name === 'release-smoke-render-evidence'));
      const browserMetrics = primaryTests.map(row => {
        const metricsAttachment = row.attachments.find(attachment => attachment.name === 'release-smoke-render-evidence');
        const layoutAttachment = row.attachments.find(attachment => attachment.name === 'release-smoke-last-card-layout');
        return {
          project: row.project,
          metrics: metricsAttachment ? JSON.parse(attachmentJson(metricsAttachment)) : null,
          lastCardLayout: layoutAttachment ? JSON.parse(attachmentJson(layoutAttachment)) : null,
        };
      });
      const expectedMetrics = ['on-hand', 'review', 'available', 'open-stock', 'loc-photo-match', 'loc-on-hand'];
      const evidenceValid = browserMetrics.length === 3 && browserMetrics.every(({ project, metrics, lastCardLayout }) =>
        report.browserProjects.includes(project) && metrics?.cards === 37 && metrics.expectedCards === 37
        && metrics.masterRows >= 9000 && metrics.renderMs >= 0 && metrics.renderMs <= 2000
        && metrics.sorted === true && metrics.metricsVerified === true && metrics.productionWrites === false
        && lastCardLayout?.inViewport === true && lastCardLayout.cardOverflow === false && lastCardLayout.completeTagVisible === true
        && expectedMetrics.every(id => lastCardLayout.metrics?.some(metric => metric.id === id
          && metric.label && metric.value && metric.labelSingleLine === true && metric.valueSingleLine === true)));
      if (!evidenceValid) {
        report.playwright.status = 'evidence-invalid';
        report.playwright.validationError = 'RELEASE_SMOKE_METRIC_OR_LAST_CARD_EVIDENCE_INVALID';
      } else {
        report.playwright.tests = results.map(({ attachments: _attachments, ...row }) => row);
        report.playwright.browserEvidence = browserMetrics;
        report.playwright.resultsSha256 = sha256(bytes);
      }
    }
  }
  if (sourceDigest(root) !== currentSourceDigest || siteDigest(siteDir) !== currentSiteDigest) {
    report.playwright.status = 'identity-changed';
    report.playwright.validationError = 'RELEASE_SMOKE_SOURCE_OR_SITE_CHANGED';
  }
  report.completedAt = new Date().toISOString();
  report.durationMs = Date.parse(report.completedAt) - Date.parse(startedAt);
  report.status = report.playwright.status === 'passed' && report.durationMs < 300_000 ? 'passed' : 'failed';
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  print(`${report.status === 'passed' ? 'RELEASE_SMOKE_PASSED' : 'RELEASE_SMOKE_FAILED'} ${report.release} ${report.commit} ${report.durationMs}ms ${reportPath}`);
  if (report.status !== 'passed') {
    const tail = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).slice(-40).join('\n');
    if (tail) print(tail);
    fail(report.playwright.validationError || report.playwright.error || 'RELEASE_SMOKE_FAILED');
  }
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runReleaseSmoke().catch(error => { console.error(error.message); process.exitCode = 1; });
}
