import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeSourceText, auditChanges, introducedFindings } from '../scripts/check-architecture.mjs';

test('finds empty catches and only straight-line unreachable statements', () => {
  const result = analyzeSourceText(`
    try { run(); } catch (error) { /* comment alone is not handling */ }
    function safe() { try { run(); } catch (error) { notify(error); } }
    function later() { return 1; doMore(); }
  `);
  assert.equal(result.findings.filter(finding => finding.rule === 'empty-catch').length, 1);
  assert.equal(result.findings.filter(finding => finding.rule === 'unreachable').length, 1);
});

test('finds newly declared classic globals and explicit shared-global writes', () => {
  const result = analyzeSourceText(`
    window.GNC_TEMP = true;
    globalThis['pendingState'] = {};
    Object.assign(window, { anotherState: 1 });
    window.location.href = '/home';
    window.document.title = 'Que';
    const localModuleValue = 1;
  `, 'assets/new-classic.js');
  assert.equal(result.findings.filter(finding => finding.rule === 'global-write').length, 3);
  assert.equal(result.findings.filter(finding => finding.rule === 'global-declaration').length, 1);
});

test('allows imports, exports, parameters, members, and same-file referenced locals', () => {
  const result = analyzeSourceText(`
    import { useMemo } from 'react';
    export const publicValue = useMemo(() => 1, []);
    function render(item) { const local = item.value; return local; }
    const record = { label: 'ok', method() { return this.label; } };
    void render(record);
  `, 'components/Widget.tsx');
  assert.deepEqual(result.findings.filter(finding => finding.rule === 'unused-candidate'), []);
  assert.equal(result.findings.some(finding => finding.rule === 'global-declaration'), false);
});

test('reports unused local bindings as review candidates without flagging parameters', () => {
  const result = analyzeSourceText(`export function component(usedParameter) { const stale = 3; return usedParameter; }`, 'components/Panel.tsx');
  const unused = result.findings.filter(finding => finding.rule === 'unused-candidate');
  assert.equal(unused.length, 1);
  assert.match(unused[0].message, /variable stale/);
});

test('parses the marked main app payload while skipping other inert data and external scripts', () => {
  const html = `<script type="application/json">{"ok":true}</script>
    <script id="app-script-source" type="text/plain">function mainApp() { try { run(); } catch (error) {} }</script>
    <script type="text/plain">large inert preview payload</script>
    <script src="./external.js"></script>
    <script>window.App = true;</script>`;
  const result = analyzeSourceText(html, 'index.html');
  assert.equal(result.metrics.inlineScripts, 2);
  assert.equal(result.metrics.inertDataScripts, 1);
  assert.equal(result.metrics.inertScripts, 2);
  assert.equal(result.findings.some(finding => finding.rule === 'global-write'), true);
  assert.equal(result.findings.filter(finding => finding.rule === 'empty-catch').length, 1);
  assert.equal(result.findings.find(finding => finding.rule === 'empty-catch').file, 'index.html#inline-app-script-source');
  assert.equal(result.findings.some(finding => finding.rule === 'parse-error'), false);
});

test('does not execute arbitrary text/plain payloads without the main source marker', () => {
  const result = analyzeSourceText(`<script type="text/plain">window.inert = true;</script>`, 'index.html');
  assert.equal(result.metrics.inlineScripts, 0);
  assert.equal(result.findings.some(finding => finding.rule === 'global-write'), false);
});

test('compares normalized finding fingerprints and retains duplicate counts', () => {
  const before = [
    { fingerprint: 'empty-catch:catch { }' },
    { fingerprint: 'empty-catch:catch { }' },
  ];
  const current = [{ fingerprint: 'empty-catch:catch { }' }, { fingerprint: 'global-write:window.App = 1' }];
  assert.deepEqual(introducedFindings(current, before), [current[1]]);
});

test('analyzes legacy shell fragments without executing them', () => {
  const result = analyzeSourceText(`<script>(function(){ const privateValue = 4; return privateValue; })();</script>`, 'index.html');
  assert.equal(result.findings.some(finding => finding.rule === 'parse-error'), false);
  assert.equal(result.findings.some(finding => finding.rule === 'global-declaration'), false);
});

test('supports JSX syntax with TypeScript parsing', () => {
  const result = analyzeSourceText(`export function Card({ title }) { return <section>{title}</section>; }`, 'components/Card.jsx');
  assert.equal(result.findings.some(finding => finding.rule === 'parse-error'), false);
  assert.equal(result.findings.some(finding => finding.rule === 'unused-candidate'), false);
});

test('does not treat nested block-scoped declarations as browser globals', () => {
  const result = analyzeSourceText(`if (ready) { const localOnly = 1; use(localOnly); }`, 'assets/check.js');
  assert.equal(result.findings.some(finding => finding.rule === 'global-declaration'), false);
});

test('does not apply browser-global rules to Apps Script or test harnesses', () => {
  const appsScript = analyzeSourceText(`function doGet() { globalThis.cache = {}; }`, 'Code.gs');
  const testHarness = analyzeSourceText(`window.mockApi = {};`, 'tests/feature.test.mjs');
  assert.equal(appsScript.findings.some(finding => finding.rule.startsWith('global-')), false);
  assert.equal(testHarness.findings.some(finding => finding.rule.startsWith('global-')), false);
});

test('does not mistake a locally shadowed window parameter for global pollution', () => {
  const result = analyzeSourceText(`function update(window) { window.localValue = 1; }`, 'components/Widget.jsx');
  assert.equal(result.findings.some(finding => finding.rule === 'global-write'), false);
});

test('checks staging browser modules for shared global writes', () => {
  const result = analyzeSourceText(`globalThis.stagingState = {};`, 'scripts/staging/adapter.mjs');
  assert.equal(result.findings.filter(finding => finding.rule === 'global-write').length, 1);
});

test('collects source-located function, state, and classic-global report symbols', () => {
  const result = analyzeSourceText(`<script>var queRows = [];
    function loadSuspendTagRows() { return queRows; }</script>`, 'index.html');
  assert.ok(result.symbols.functions.some(symbol => symbol.name === 'loadSuspendTagRows' && symbol.file.startsWith('index.html#')));
  assert.ok(result.symbols.stateBindings.some(symbol => symbol.name === 'queRows' && symbol.domain === 'que-bunch-suspend'));
  assert.ok(result.symbols.globals.some(symbol => symbol.name === 'queRows' && symbol.references > 0));
});

test('enforces the 500-line cap only for new authored text files', async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'architecture-audit-'));
  try {
    const oversized = Array.from({ length: 501 }, (_, index) => `line ${index + 1}`).join('\n');
    await writeFile(path.join(fixtureRoot, 'fixture.txt'), oversized);
    await writeFile(path.join(fixtureRoot, 'CODEOWNERS'), oversized);
    await writeFile(path.join(fixtureRoot, 'binary.unknown'), Buffer.from([0, 1, 2, 3]));
    const result = auditChanges({ base: 'HEAD', paths: ['fixture.txt', 'CODEOWNERS', 'binary.unknown'], rootDir: fixtureRoot });
    assert.equal(result.failures.length, 2);
    assert.ok(result.failures.every(failure => failure.rule === 'new-file-size'));
    assert.ok(result.failures.every(failure => /501 lines; limit is 500/.test(failure.message)));
    assert.deepEqual(result.failures.map(failure => failure.file).sort(), ['CODEOWNERS','fixture.txt']);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
