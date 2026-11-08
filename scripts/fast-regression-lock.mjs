import {clearForeignGitEnvironment} from './source-git-environment.mjs';
import { readFile, readdir, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { verifyDriveGeometryReceipt } from './drive-mobile-geometry.mjs';
import { forbiddenAssetText, liveAssetVersionFailures } from './fast-regression-contracts.mjs';
import { program } from './fast-feature-lock.mjs';
import { engineeringProofFailures } from './engineering-proof.mjs';
import { monolithFailures } from './monolith-growth-lock.mjs';

if (process.argv.includes('--artifact-root')) clearForeignGitEnvironment(process.env);
const started = performance.now();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
let engineeringMs = 0;
const syntaxFiles = ['assets/app-runtime.js', 'assets/row-workflow-functions.js', 'assets/runtime-watchdog.js','assets/storage-request-guard.js','assets/live-sync-coordinator.js','assets/navigation-preferences.js','components/common/auraVoiceWidget.js','assets/app-update-state.js','assets/live-app-update.js','assets/app-lifecycle.js','sw.js'];
const readCache = new Map();
const readAbsolute = file => { if (!readCache.has(file)) readCache.set(file,readFile(file,'utf8')); return readCache.get(file); };
const read = file => readAbsolute(path.join(root,file));
const fail = message => errors.push(message);
const requireMatch = (source, expression, label) => { if (!expression.test(source)) fail(label); };
// Contract checks inspect implementation, not comments or documentation labels.

async function assetTextFiles(directory) {
  const files=[];
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const file=path.join(directory,entry.name);
    if(entry.isDirectory() && entry.name!=='node_modules') files.push(...await assetTextFiles(file));
    else if(entry.isFile() && /\.(?:[cm]?js|tsx?|css|html?|json|svg|txt|md|webmanifest)$/i.test(entry.name)) files.push(file);
  }
  return files;
}
async function assertAssetText(directory,label) {
  await Promise.all((await assetTextFiles(directory)).map(async file=>{
    for(const phrase of forbiddenAssetText(await readAbsolute(file))) fail(label+': '+path.relative(directory,file)+': forbidden asset text '+phrase);
  }));
}

function checkSyntax(file) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--check', path.join(root, file)], { windowsHide: true });
    let detail = '';
    child.stderr.on('data', chunk => { detail += chunk; });
    child.on('error', error => { fail(`${file}: ${error.message}`); resolve(); });
    child.on('close', code => { if (code) fail(`${file}: syntax invalid\n${detail.trim()}`); resolve(); });
  });
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!/^(?:vendor|node_modules|tests?|fixtures?|__tests__)$/.test(entry.name)) files.push(...await sourceFiles(path.join(directory, entry.name)));
    } else if (entry.isFile() && /\.(?:[cm]?js|tsx?)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) files.push(path.join(directory, entry.name));
  }
  return files;
}

const featureChecks = [];
function featureContracts(composed, engine, label = 'source', files = []) {
  featureChecks.push(new Promise(resolve => {
    const worker = new Worker(new URL('./fast-feature-lock.mjs', import.meta.url), {
      workerData:{root, files, syntaxFiles:label === 'source' ? syntaxFiles.slice(1) : [], composed, engine, label},
      execArgv:['--experimental-vm-modules'],
    });
    worker.once('message', issues => { for (const issue of issues) fail(issue); });
    worker.once('error', error => fail('feature worker: ' + error.message));
    worker.once('exit', code => { if (code) fail('feature worker exited ' + code); resolve(); });
  }));
}

function cardLayoutContracts(css, label = 'source') {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{[^{}]*\}/g) || [];
  const owns = (selector, declaration) => rules.some(rule => selector.test(rule.split('{')[0]) && declaration.test(rule.slice(rule.indexOf('{') + 1)));
  if (!owns(/#av-content/, /grid-auto-rows\s*:\s*max-content\s*!important/)) fail(label + ': AV natural grid rows missing');
  if (!owns(/\.app-av-catalog-card/, /flex-shrink\s*:\s*0\s*!important[\s\S]*min-height\s*:\s*max-content/)) fail(label + ': AV non-shrinking natural card height missing');
  if (!owns(/\.agdata-results-scroll/, /display\s*:\s*block\s*!important[\s\S]*overflow-y\s*:\s*auto/)) fail(label + ': results scroller block layout missing');
  if (!owns(/\[data-av-load-more\]/, /position\s*:\s*static\s*!important/)) fail(label + ': AV continuation must remain in flow');
}

function versionContracts(version, index, worker, runtime, label) {
  const expected = String(version.version || '');
  const numbers=expected.split('.').map(Number);
  if(numbers.length!==3 || !numbers.every(Number.isInteger) || numbers[0]<3 || numbers[0]===3 && (numbers[1]<0 || numbers[1]===0 && numbers[2]<25))fail(label+': release predates canonical engine lock');
  if (!/^\d+\.\d+\.\d+$/.test(expected) || version.release !== `AgData v${expected}`) fail(`${label}: version.json invalid`);
  for (const issue of liveAssetVersionFailures(index, expected)) fail(label + ': ' + issue);
  const escaped = expected.replaceAll('.', '\\.');
  requireMatch(index, new RegExp(`name=["']agdata-release["']\\s+content=["']${escaped}["']`), `${label}: index release mismatch`);
  for (const name of ['__APP_SHELL_VERSION__', '__APP_RELEASE_VERSION__']) requireMatch(index, new RegExp(`${name}\\s*=\\s*["']AgData v${escaped}["']`), `${label}: ${name} mismatch`);
  for (const [name, prefix] of [['APP_SHELL_BUILD','AgData v'], ['APP_ASSET_VERSION',''], ['CACHE_VERSION','agdata-v']]) requireMatch(worker, new RegExp(`const ${name}\\s*=\\s*["']${prefix}${escaped}["']`), `${label}: ${name} mismatch`);
  requireMatch(runtime, new RegExp(`const APP_VERSION\\s*=\\s*["']${escaped}["']`), `${label}: runtime version mismatch`);
  requireMatch(runtime, new RegExp(`APP_SHELL_VERSION[^;]+["']AgData v${escaped}["']`), `${label}: runtime shell fallback mismatch`);
  return expected;
}

function liveUpdateContracts(source, label) {
  const parsed=program(source);
  for(const name of ['saveWorkStateBeforeAppUpdate','getAppUpdateBusyState','isAppUpdateSnapshotCurrent','commitAppUpdateSnapshotForReload'])if(!parsed.calls.some(call=>call.name===name))fail(label+': update handoff missing '+name);
  requireMatch(parsed.code, /checkForLiveAppUpdate/, label+': live version poller missing');
  requireMatch(parsed.code, /updateViaCache\s*:\s*['"]none['"]/, label+': worker registration may use stale HTTP cache');
  requireMatch(parsed.code, /cache\s*:\s*['"]no-store['"]/, label+': live version read must bypass HTTP cache');
  requireMatch(parsed.code, /45_?000/, label+': live version interval changed');
}

async function artifactContracts(artifact, expected) {
    const [artifactIndex, artifactWorker, artifactVersionText, artifactRuntime, artifactEngine] = await Promise.all([
      'index.html','sw.js','version.json','assets/live-app-runtime-v2026082010.min.js','assets/eval-reports-engine.js',
    ].map(file => readFile(path.join(artifact,file),'utf8')));
    const actual = versionContracts(JSON.parse(artifactVersionText),artifactIndex,artifactWorker,artifactRuntime,'Pages artifact');
    liveUpdateContracts(await readFile(path.join(artifact,'assets/live-app-update.js'),'utf8'),'Pages artifact');
    if (actual !== expected) fail('Pages artifact differs from source release');
    await access(path.join(artifact,'.nojekyll')).catch(() => fail('Pages artifact: root .nojekyll missing'));
    await assertAssetText(path.join(artifact,'assets'),'Pages artifact');
    // The minifier preserves names; enforce the same implementation contracts.
    featureContracts(artifactRuntime,artifactEngine,'Pages artifact');
    cardLayoutContracts(await readFile(path.join(artifact,'assets/app-styles.css'),'utf8'), 'Pages artifact');
    await verifyDriveGeometryReceipt(root,artifact).catch(error => fail(error.message));
}

try {
  const syntax = checkSyntax(syntaxFiles[0]);
  const monolith = monolithFailures(root);
  const engineeringStarted = performance.now();
  const engineering = engineeringProofFailures(root).catch(error => [error.message]).then(issues => {
    engineeringMs = performance.now() - engineeringStarted;
    return issues;
  });
  const [runtime, row, index, worker, versionText, engine, files] = await Promise.all([
    read(syntaxFiles[0]), read(syntaxFiles[1]), read('index.html'), read('sw.js'), read('version.json'), read('assets/eval-reports-engine.js'),
    Promise.all(['assets', 'supabase/functions'].map(directory => sourceFiles(path.join(root, directory)))).then(groups => groups.flat()),
  ]);
  const fragments = [...runtime.matchAll(/\/\* @runtime-fragment (assets\/[a-z0-9-]+\.js) \*\//g)];
  if (!fragments.some(match => match[1] === 'assets/row-workflow-functions.js')) fail('composed runtime does not include row-workflow-functions.js');
  const fragmentSources = new Map(await Promise.all(fragments.map(async match => [match[1], match[1] === syntaxFiles[1] ? row : await read(match[1])])));
  const composed = runtime.replace(/\/\* @runtime-fragment (assets\/[a-z0-9-]+\.js) \*\//g, (_, file) => fragmentSources.get(file));
  const composedFiles = new Set([syntaxFiles[0], ...fragmentSources.keys()].map(file => path.resolve(root, file)));
  featureContracts(composed, engine, 'source', files.filter(file => !composedFiles.has(path.resolve(file))));
  const expected = versionContracts(JSON.parse(versionText), index, worker, runtime, 'source');
  const artifactFlag = process.argv.indexOf('--artifact-root');
  if (artifactFlag >= 0 && !process.argv[artifactFlag + 1]) throw new Error('--artifact-root requires a directory');
  const artifactChecks = artifactFlag < 0 ? Promise.resolve() : artifactContracts(path.resolve(process.argv[artifactFlag + 1]), expected).catch(error => fail(error.message));
  liveUpdateContracts(await read('assets/live-app-update.js'), 'source');
  await read('assets/app-update-state.js');
  await read('assets/app-lifecycle.js');
  requireMatch(index, /live-app-update\.js\?v=/, 'source: live update owner script missing');
  for(const key of ['salesyear','season','lotcode','contsize','holdstopcode'])if(!index.includes('id="drive-excel-'+key+'-btn"'))fail('source: Drive static sibling trigger missing '+key);
  for(const key of ['salesyear','season','lotcode','contsize','holdstopcode'])if(!index.includes('data-drive-excel-field="'+key+'"'))fail('source: missing Drive header control '+key);
  const packageVersion=JSON.parse(await read('package.json')).version;
  if(packageVersion!==expected)fail('source: package/version.json release mismatch');
  const sourceScripts=[...index.matchAll(/<script\b[^>]*>/gi)].map(match=>match[0]);
  const updateFragmentPosition=sourceScripts.findIndex(tag=>/assets\/app-update-state\.js\?v=/.test(tag));
  const runtimePosition=sourceScripts.findIndex(tag=>/assets\/app-runtime\.js\?v=/.test(tag));
  if(updateFragmentPosition<0 || runtimePosition<0 || updateFragmentPosition>=runtimePosition)fail('source: update restore fragment must load before runtime');
  if(sourceScripts.some(tag=>/\btype=["']module["']/i.test(tag)&&/app-runtime|row-workflow|state-store|api-sync/i.test(tag)))fail('source: classic runtime loading changed');
  await assertAssetText(path.join(root,'assets'),'source');
  await access(path.join(root, '.nojekyll')).catch(() => fail('source: root .nojekyll missing'));
  for (const issue of await engineering) fail(issue);
  for (const issue of await monolith) fail(issue);
  await verifyDriveGeometryReceipt(root).catch(error => fail(error.message));
  cardLayoutContracts(await read('assets/app-styles.css'));
  requireMatch(composed, /root:\s*getMainAreaScrollTarget\(\),\s*rootMargin:\s*['"]400px['"]/, 'AV continuation must observe active results scroller');
  await artifactChecks;
  await Promise.all(featureChecks);
  await syntax;
} catch (error) { fail(error.message); }
const elapsed = performance.now() - started;
if (elapsed >= 2000) fail(`fast lock exceeded 2 seconds (${Math.round(elapsed)} ms)`);
if (errors.length) {
  console.error(`FAST REGRESSION LOCK FAILED (${Math.round(elapsed)} ms; engineering ${Math.round(engineeringMs)} ms)\n${errors.map(error => `- ${error}`).join('\n')}`);
  process.exitCode = 1;
} else console.log(`FAST REGRESSION LOCK PASS (${Math.round(elapsed)} ms): syntax, forbidden blocks, core features, .nojekyll, matching versions.`);
