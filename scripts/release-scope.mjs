import { execFileSync } from 'node:child_process';
import { testScopeForPaths } from './ci-test-scope.mjs';

const sha = /^[a-f0-9]{40}$/i;
const normalize = value => String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
const isUnder = (file, prefix) => file.startsWith(prefix);
const isSiteSource = file => [
  'assets/', 'components/', 'styles/', 'src/', 'v2/', 'pages/', 'services/', 'utils/',
  'live-src/', 'performance/',
].some(prefix => isUnder(file, prefix)) || [
  'index.html', 'manifest.json', 'OneSignalSDKWorker.js', 'CNAME', 'lighthouserc.json',
].includes(file) || /^Dockerfile(?:\.|$)/i.test(file) && !/^Dockerfile\.validation(?:\.dockerignore)?$/i.test(file)
  || /^(?:playwright|vite).*\.config\.[^/]+$/i.test(file)
  || /^tsconfig[^/]*\.json$/i.test(file)
  || ['package.json', 'package-lock.json'].includes(file);

const isSupabaseDeploySource = file => /^supabase\/(?:migrations|archive_migrations)\/[^/]+\.sql$/i.test(file)
  || /^supabase\/functions\/[^/]+\//i.test(file)
  || /^database\/(?:migrations\/)?[^/]+\.sql$/i.test(file)
  || file === 'supabase/config.toml';

const isAppsScriptDeploySource = file => file === 'Code.gs';

const isToolingPath = file => isUnder(file, '.github/') || isUnder(file, 'scripts/')
  || isUnder(file, 'tests/') || isUnder(file, '.codex/') || isUnder(file, 'docs/')
  || ['.gitattributes', '.gitignore', 'AGENTS.md', 'Dockerfile.validation', 'Dockerfile.validation.dockerignore',
    'docker-compose.validation.yml'].includes(file);

export function classifyReleasePaths(paths, { packageMetadataOnly = false } = {}) {
  const files = [...new Set((paths || []).map(entry => normalize(typeof entry === 'string' ? entry : entry?.path))
    .filter(Boolean))].sort();
  const deploy = {
    frontend: files.some(file => isSiteSource(file) && !(packageMetadataOnly && ['package.json', 'package-lock.json'].includes(file))),
    supabase: files.some(isSupabaseDeploySource),
    appsScript: files.some(isAppsScriptDeploySource),
  };
  const migrations = files.filter(file => /^supabase\/(?:migrations|archive_migrations)\/[^/]+\.sql$/i.test(file)
    || /^database\/(?:migrations\/)?[^/]+\.sql$/i.test(file)).sort();
  const changedEdgeFunctions = [...new Set(files.map(file => /^supabase\/functions\/([^/]+)\//i.exec(file)?.[1])
    .filter(name => name && name !== '_shared'))].sort();
  const sharedEdgeChange = files.some(file => /^supabase\/functions\/_shared\//i.test(file) || file === 'supabase/config.toml');
  const toolingOnly = files.length > 0 && !deploy.frontend && !deploy.supabase && !deploy.appsScript
    && files.every(file => isToolingPath(file)
      || (packageMetadataOnly && ['package.json', 'package-lock.json'].includes(file)));
  const selected = testScopeForPaths(files);
  const validation = toolingOnly
    ? { frontend: false, backend: false, schema: false }
    : { frontend: selected.frontend, backend: selected.backend, schema: selected.schema };
  return { files, deploy, validation, toolingOnly, migrations,
    edgeFunctions: sharedEdgeChange ? ['*'] : changedEdgeFunctions };
}

export function isSafePackageMetadataChange(beforePackage, afterPackage) {
  const stripAllowedMetadata = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'scopedValidationReceipt'));
  };
  return JSON.stringify(stripAllowedMetadata(beforePackage)) === JSON.stringify(stripAllowedMetadata(afterPackage));
}

export function selectReleaseRecoveryBase({ scope, manualBase = '', lastSuccessfulBase = '', isAncestor = () => false }) {
  if (scope?.toolingOnly) return '';
  if (manualBase && lastSuccessfulBase && manualBase !== lastSuccessfulBase
      && isAncestor(lastSuccessfulBase, manualBase)) return lastSuccessfulBase;
  return manualBase || lastSuccessfulBase || '';
}

export function changedReleasePaths({ rootDir = process.cwd(), before, after }) {
  if (!sha.test(String(before || '')) || !sha.test(String(after || ''))) {
    throw new Error('RELEASE_SCOPE_COMMIT_INVALID');
  }
  let output;
  try {
    output = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', `${before}..${after}`], {
      cwd: rootDir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    throw new Error('RELEASE_SCOPE_COMPARISON_FAILED');
  }
  return [...new Set(output.split('\0').map(normalize).filter(Boolean))].sort();
}
