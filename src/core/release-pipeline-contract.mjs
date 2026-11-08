import assert from 'node:assert/strict';

export function pagesRecoveryScopeContract(pages) {
  const classify=pages.jobs['fast-gate'].steps.find(step=>step.id==='classify').run;
  assert.match(classify,/findLastSuccessfulDeploymentBaseline/);
  assert.match(classify,/packageMetadataSafe\(before\)/);
  assert.match(classify,/shouldRecoverFrontend\(initialScope\) \? await recover\('frontend'\)/);
  assert.match(classify,/initialScope\.deploy\.supabase \|\| initialScope\.deploy\.appsScript/);
  assert.match(classify,/merge-base', '--is-ancestor/);
  assert.match(classify,/selectReleaseRecoveryBase/);
  assert.match(classify,/changedReleasePaths\(\{ before, after: commit \}\)/);
}
