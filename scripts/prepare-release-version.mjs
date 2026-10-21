import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeRelease } from './deployment-fingerprint-lib.mjs';

export function prepareReleaseVersion(root=process.cwd(), check=false) {
  const read=p=>fs.readFileSync(path.join(root,p),'utf8');
  const packageManifest=JSON.parse(read('package.json'));
  const version=packageManifest.version;
  const preservedScriptRelease=packageManifest.appsScriptRelease;
  if (preservedScriptRelease !== undefined && normalizeRelease(preservedScriptRelease) !== preservedScriptRelease) throw new Error('RELEASE_APPS_SCRIPT_PIN_INVALID');
  const next=normalizeRelease(`V${version}`), changes=[];
  if (!next) throw new Error('RELEASE_VERSION_INVALID');
  const markers={
    'index.html':/window\.__APP_SHELL_VERSION__\s*=\s*['"]([^'"]+)['"]/, 
    'manifest.json':/"version"\s*:\s*"([^"]+)"/,
    'sw.js':/const APP_SHELL_BUILD\s*=\s*['"]([^'"]+)['"]/, 
    'scripts/build-live-shell.mjs':/const RELEASE\s*=\s*['"]([^'"]+)['"]/,
    'v2/src/services/api.ts':/export const APP_VERSION\s*=\s*['"]([^'"]+)['"]/,
    'v2/public/manifest.webmanifest':/"version"\s*:\s*"([^"]+)"/
  };
  if (fs.existsSync(path.join(root,'assets/app-runtime.js'))) markers['assets/app-runtime.js'] = /const APP_SHELL_VERSION\s*=\s*[^\n]*?\|\|\s*['"]([^'"]+)['"]/;
  if (fs.existsSync(path.join(root,'Code.gs'))) {
    if (preservedScriptRelease) {
      const actual=read('Code.gs').match(/const APP_RELEASE_VERSION_\s*=\s*['"]([^'"]+)['"]/)?.[1];
      if (actual !== preservedScriptRelease) throw new Error('RELEASE_APPS_SCRIPT_PIN_MISMATCH');
    } else markers['Code.gs'] = /const APP_RELEASE_VERSION_\s*=\s*['"]([^'"]+)['"]/;
  }
  if (fs.existsSync(path.join(root,'assets/ops-precision-pilot.js'))) markers['assets/ops-precision-pilot.js'] = /const RELEASE\s*=\s*['"]([^'"]+)['"]/;
  for (const [file,marker] of Object.entries(markers)) {
    const before=read(file), previous=before.match(marker)?.[1];
    if (!normalizeRelease(previous) && !/^V\d{4}\.\d{2}\.\d{2}\.v2\.\d+$/.test(previous || '')) throw new Error(`RELEASE_MARKER_MISSING:${file}`);
    if (file==='v2/public/manifest.webmanifest' && JSON.parse(before).start_url!==`./?shellv=${encodeURIComponent(previous)}`) throw new Error('RELEASE_V2_START_URL_MISMATCH');
    let after=before.replaceAll(previous,next);
    if (file==='index.html') after=after.replace(/(window\.__APP_RELEASE_VERSION__\s*=\s*['"])[^'"]+(['"])/, `$1${next}$2`);
    if (encodeURIComponent(previous)!==previous) after=after.replaceAll(encodeURIComponent(previous),encodeURIComponent(next));
    after=after.replaceAll(`?v=${next}`,`?v=${encodeURIComponent(next)}`).replaceAll(`&v=${next}`,`&v=${encodeURIComponent(next)}`);
    if (file==='manifest.json' || file==='v2/public/manifest.webmanifest') {
      after=after.replaceAll(`shellv=${encodeURIComponent(previous)}`,`shellv=${encodeURIComponent(next)}`)
        .replaceAll(`shellv=${next}`,`shellv=${encodeURIComponent(next)}`);
    }
    if (check && before!==after) throw new Error(`RELEASE_VERSION_MISMATCH:${file}`);
    if (before!==after) changes.push([file,after]);
  }
  const lock=JSON.parse(read('package-lock.json'));
  if (check && (lock.version!==version || lock.packages[''].version!==version)) throw new Error('RELEASE_LOCK_VERSION_MISMATCH');
  if (!check) {
    lock.version=version; lock.packages[''].version=version;
    changes.push(['package-lock.json',JSON.stringify(lock,null,2)+'\n']);
    for (const [file,contents] of changes) fs.writeFileSync(path.join(root,file),contents);
  }
  return next;
}
if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.slice(2).some(x=>x!=='--check')) throw new Error('Usage: node scripts/prepare-release-version.mjs [--check]');
  console.log(prepareReleaseVersion(process.cwd(),process.argv.includes('--check')));
}
