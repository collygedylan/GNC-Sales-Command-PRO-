// Keep these categories aligned with performance-monitor.yml's path filters.
// Release proof verification independently checks every changed PR path.
export function testScopeForPaths(paths) {
  const schema = name => /^(supabase|migrations|database\/migrations)\//.test(name) || /(?:^|\/)[^/]*_migration\.sql$/.test(name);
  const backendOnly = name => schema(name) || ['deno.lock', 'deno.json', 'deno.jsonc'].includes(name);
  const shared = name => ['.github/', 'scripts/', 'tests/'].some(prefix => name.startsWith(prefix))
    || ['package.json', 'package-lock.json'].includes(name);
  const frontend = name => ['assets/', 'components/', 'styles/', 'src/', 'v2/', 'pages/', 'services/', 'utils/', 'live-src/', 'performance/'].some(prefix => name.startsWith(prefix))
    || shared(name) || ['index.html', 'Code.gs', 'manifest.json', 'OneSignalSDKWorker.js', 'CNAME', 'lighthouserc.json'].includes(name)
    || /^(playwright|vite).*\.config\.[^/]+$/.test(name) || /^tsconfig[^/]*\.json$/.test(name);
  return { frontend: paths.some(frontend), backend: paths.some(name => backendOnly(name) || shared(name)), schema: paths.some(schema) };
}

export function maySkipTestJob(name, scope, { fastPr = false } = {}) {
  if (!scope.backend && /^validation \/ database(?: \/|$)/.test(name)) return true;
  if (!scope.schema && /^validation \/ database \/ (?:integration|schema-contracts|suspend-tag-approval|database-and-functions)(?: \(|$)/.test(name)) return true;
  if (name === 'validation / fast-browser') return !scope.frontend || !fastPr;
  return (fastPr || !scope.frontend) && /^validation \/ (?:foundation|functional|compiled|timing|performance|lighthouse)(?: \(|$)/.test(name);
}
