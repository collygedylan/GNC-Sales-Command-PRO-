import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildDeploymentFingerprint, readExpectedRelease } from './deployment-fingerprint-lib.mjs';

const root = path.resolve(process.cwd());
const siteRoot = path.resolve(root, process.env.DEPLOYMENT_SITE_DIR || '_site');
const release = await readExpectedRelease(root);
const commit = String(process.env.GITHUB_SHA || process.env.DEPLOYMENT_COMMIT || '').trim();
const fingerprint = buildDeploymentFingerprint({ release, commit });

const sourceChecks = [
  ['index.html', `window.__APP_SHELL_VERSION__ = '${release}'`],
  ['manifest.json', `"version": "${release}"`],
  ['sw.js', `const APP_SHELL_BUILD = '${release}'`],
  ['scripts/build-live-shell.mjs', `const RELEASE = '${release}'`],
  ['v2/src/services/api.ts', `export const APP_VERSION = '${release}'`],
  ['v2/public/manifest.webmanifest', `"version": "${release}"`],
  ['v2/public/manifest.webmanifest', `"start_url": "./?shellv=${release}"`]
];

for (const [fileName, expectedText] of sourceChecks) {
  const source = await readFile(path.join(root, fileName), 'utf8');
  if (!source.includes(expectedText)) throw new Error(`DEPLOYMENT_RELEASE_SOURCE_MISMATCH_${fileName.replace(/[^a-z0-9]+/gi, '_').toUpperCase()}`);
}

const v2Manifest = JSON.parse(await readFile(path.join(siteRoot, 'v2', 'manifest.webmanifest'), 'utf8'));
if (v2Manifest.version !== release || v2Manifest.start_url !== `./?shellv=${release}`) {
  throw new Error('DEPLOYMENT_RELEASE_V2_MANIFEST_MISMATCH');
}

await mkdir(path.join(siteRoot, 'deployments'), { recursive: true });
const serialized = `${JSON.stringify(fingerprint, null, 2)}\n`;
await Promise.all([
  writeFile(path.join(siteRoot, 'deployment.json'), serialized, 'utf8'),
  writeFile(path.join(siteRoot, 'deployments', `${fingerprint.commit}.json`), serialized, 'utf8')
]);

console.log(`Wrote deployment fingerprint ${fingerprint.release} ${fingerprint.commit.slice(0, 7)}.`);
