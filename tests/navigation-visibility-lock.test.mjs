import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {minify} from 'terser';
import {readComposedRuntimeSource} from '../scripts/composed-app-source.mjs';
import {program, navigationVisibilityFailures} from '../scripts/fast-feature-lock.mjs';

const source = readComposedRuntimeSource();
const compiled = fs.readFileSync(new URL('../_site/assets/live-app-runtime-v2026082010.min.js', import.meta.url), 'utf8');
const owners = ['switchView','openDisplayOnlyNavigation','syncRoleAccessUi','syncNavigationVisibilityUi',
  'syncHomeModuleVisibility','syncRegisteredNavigationElements'];
const canonical = owners.map(name => program(source).functions.get(name)[0].source).join('\n');
const issues = text => navigationVisibilityFailures(program(text), 'fixture');

async function assertSourceAndMinified(text, pattern = null) {
  const compact = (await minify(text, {compress:false,mangle:false,keep_fnames:true,format:{comments:false}})).code;
  for (const value of [text, compact]) {
    if (pattern) assert.ok(issues(value).some(issue => pattern.test(issue)), 'Bypass passed: ' + value.slice(0, 120));
    else assert.deepEqual(issues(value), []);
  }
}

test('navigation contract accepts real source and release-minified canonical routes', () => {
  assert.deepEqual(issues(source), []);
  assert.deepEqual(issues(compiled), []);
});

test('navigation contract accepts harmless guard braces, spacing, comments and local renames', async () => {
  const safe = canonical.replace('const target =', 'let target =')
    .replace('if (!canAccessView(target)) return openDisplayOnlyNavigation(target, options);',
      'if (!canAccessView(target)) { return openDisplayOnlyNavigation(target, options); }')
    .replace('let target =', 'let target = /* normalize { the route } */')
    .replace(/\belement\b/g, 'entry').replace(/\bvisible\b/g, 'allowedForView');
  await assertSourceAndMinified(safe);
});

test('navigation contract rejects missing, fake or displaced display and operation guards', async () => {
  const variants = [
    canonical.replace('!canDisplayNavigationView(target)', 'false'),
    canonical.replace('!canAccessView(target)', 'false'),
    canonical.replace('const target =', "renderViewContent('drive'); const target ="),
    canonical.replace('if (!canAccessView(target))', 'navTransitionSeq++; if (!canAccessView(target))'),
    canonical.replace('return false;', 'void "return false";'),
    canonical.replace('return openDisplayOnlyNavigation(target, options)', 'return openDisplayOnlyNavigation(other, options)'),
    canonical.replace('return activatePrimaryNavigation(context)', 'return false')
  ];
  for (const variant of variants) await assertSourceAndMinified(variant, /router must guard|authority must match|authorized navigation phases/);
});

test('navigation contract rejects display-only hydration and broken real drawer/Home sinks', async () => {
  const variants = [
    canonical.replace('const previous = getCurrentVisibleViewId();', 'renderViewContent(viewId); const previous = getCurrentVisibleViewId();'),
    canonical.replace('syncNavigationVisibilityUi(access, userOverride, ensureHomeModuleRegistry())', 'void "syncNavigationVisibilityUi"'),
    canonical.replace('canDisplayNavigationView(element.dataset.drawerView, userOverride)', 'true'),
    canonical.replace('canDisplayNavigationView(module.view, userOverride)', 'true'),
    canonical.replace('applyNavigationElementVisibility(tile, visible)', 'applyNavigationElementVisibility(tile, true)'),
    canonical.replace('applyNavigationElementVisibility(tile, visible)', 'visible = true; applyNavigationElementVisibility(tile, visible)')
  ];
  for (const variant of variants) await assertSourceAndMinified(variant, /display-only route|Home and drawer/);
});
