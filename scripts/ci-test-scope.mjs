// Keep these categories aligned with performance-monitor.yml's path filters.
// Release artifact reuse independently checks the PR paths before accepting skips.
export function testScopeForPaths(paths) {
  const backendOnly = name => name.startsWith('supabase/')
    || ['deno.lock', 'deno.json', 'deno.jsonc'].includes(name);
  const shared = name => ['.github/', 'scripts/', 'tests/'].some(prefix => name.startsWith(prefix))
    || ['package.json', 'package-lock.json'].includes(name);
  return {
    frontend: paths.some(name => !backendOnly(name)),
    backend: paths.some(name => backendOnly(name) || shared(name)),
  };
}

export function maySkipTestJob(name, scope) {
  if (!scope.backend && /^validation \/ database(?: \/|$)/.test(name)) return true;
  return !scope.frontend && /^validation \/ (?:foundation|functional|compiled|timing|performance|lighthouse)(?: \(|$)/.test(name);
}
