import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// These outputs are rebuilt from pinned inputs; keep platform-specific generated
// bytes out of the source identity, but include them in the compiled-site digest.
const generatedFiles = new Set(['assets/live-tailwind-v2026082010.min.css',
  'assets/vendor/supabase-browser-2.112.3.min.js', 'assets/vendor/sentry-browser-10.70.0.min.js',
  'assets/vendor/fabric-6.7.1.min.mjs', 'assets/vendor/fabric-LICENSE.txt']);
export const generatedBuildOutput = file => generatedFiles.has(file)
  || /^assets\/vendor\/phosphor\/(regular|bold|duotone|fill|light)\/(style\.css|Phosphor(?:-Bold|-Duotone|-Fill|-Light)?\.woff2)$/.test(file);
const hash = () => createHash('sha256');
export function sourceDigest(root) {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  const digest = hash();
  for (const file of [...new Set(files.split('\0').filter(Boolean))].sort()) {
    if (generatedBuildOutput(file)) continue;
    const target = path.join(root, file);
    digest.update(file + '\0');
    if (!fs.existsSync(target)) { digest.update('deleted\0'); continue; }
    if (!fs.lstatSync(target).isFile()) throw new Error('LOCAL_SOURCE_FILE_INVALID: ' + file);
    digest.update(hash().update(fs.readFileSync(target)).digest());
  }
  return digest.digest('hex');
}
export function siteDigest(site) {
  const info = fs.lstatSync(site);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('LOCAL_SITE_ROOT_INVALID');
  const digest = hash();
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('LOCAL_SITE_SYMLINK_FORBIDDEN');
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) {
        digest.update(path.relative(site, file).replaceAll('\\', '/') + '\0');
        digest.update(hash().update(fs.readFileSync(file)).digest());
      } else throw new Error('LOCAL_SITE_FILE_INVALID');
    }
  }
  visit(site);
  return digest.digest('hex');
}
export function assertLocalValidation(root) {
  const file = path.join(root, '.gnc-local', 'local-check.json');
  if (!fs.existsSync(file)) throw new Error('LOCAL_CHECK_REQUIRED: run npm run check:local before dispatch.');
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (report.schemaVersion !== 'gnc-local-check-v1' || report.ok !== true) throw new Error('LOCAL_CHECK_FAILED: diagnose the saved failure before dispatch.');
  const relative = path.relative(root, report.site || '').replaceAll('\\', '/');
  if (!/^\.gnc-local\/foundation-site-[\w-]+$/.test(relative)) throw new Error('LOCAL_BUILD_PATH_INVALID');
  if (report.sourceDigest !== sourceDigest(root)) throw new Error('LOCAL_SOURCE_CHANGED: run npm run check:local for the current source.');
  if (report.siteDigest !== siteDigest(report.site)) throw new Error('LOCAL_BUILD_CHANGED: the checked compiled site is missing or changed.');
  return report;
}
