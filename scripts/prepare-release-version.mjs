import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function prepareReleaseVersion(root=process.cwd(), check=false) {
  const read=p=>fs.readFileSync(path.join(root,p),'utf8');
  const version=JSON.parse(read('package.json')).version;
  if (!/^\d{4}\.\d{2}\.\d{2}\.\d{2}$/.test(version)) throw new Error('RELEASE_VERSION_INVALID');
  const next=`V${version}`, changes=[];
  const markers={
    'index.html':/window\.__APP_SHELL_VERSION__\s*=\s*['"]([^'"]+)['"]/, 
    'manifest.json':/"version"\s*:\s*"([^"]+)"/,
    'sw.js':/const APP_SHELL_BUILD\s*=\s*['"]([^'"]+)['"]/, 
    'scripts/build-live-shell.mjs':/const RELEASE\s*=\s*['"]([^'"]+)['"]/
  };
  for (const [file,marker] of Object.entries(markers)) {
    const before=read(file), previous=before.match(marker)?.[1];
    if (!/^V\d{4}\.\d{2}\.\d{2}\.\d{2}$/.test(previous || '')) throw new Error(`RELEASE_MARKER_MISSING:${file}`);
    const after=before.replaceAll(previous,next);
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
