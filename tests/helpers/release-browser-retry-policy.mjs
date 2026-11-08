import assert from 'node:assert/strict';

export function assertBrowserRetryPolicy(load, name, CI) {
  const config = load(name);
  const retries = name === 'playwright.release-smoke.config.ts' ? 1 : CI ? 2 : 0;
  assert.equal(config.retries, retries, name);
  if (name === 'playwright.release-smoke.config.ts') {
    assert.equal(config.workers, 1, name);
    assert.equal(config.fullyParallel, false, name);
  }
  assert.notEqual(config.failOnFlakyTests, true, name);
  for (const project of config.projects || []) {
    assert.equal(project.retries ?? config.retries, retries, `${name}: ${project.name}`);
  }
}
