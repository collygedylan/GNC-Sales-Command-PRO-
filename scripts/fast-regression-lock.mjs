import { readFile, readdir, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { tokenizer } from 'acorn';

const started = performance.now();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const syntaxFiles = ['assets/app-runtime.js', 'assets/row-workflow-functions.js', 'assets/runtime-watchdog.js'];
const read = file => readFile(path.join(root, file), 'utf8');
const fail = message => errors.push(message);
const requireMatch = (source, expression, label) => { if (!expression.test(source)) fail(label); };
// Contract checks inspect implementation, not comments or documentation labels.
const codeCache = new Map();
function codeOnly(source) {
  if (codeCache.has(source)) return codeCache.get(source);
  const spans = [];
  const tokens = tokenizer(source, { ecmaVersion: 'latest', allowHashBang: true,
    onComment: (_block, _text, start, end) => spans.push([start,end]) });
  while (tokens.getToken().type.label !== 'eof') {}
  const chunks = []; let position = 0;
  for (const [start,end] of spans) { chunks.push(source.slice(position,start),' '); position = end; }
  chunks.push(source.slice(position));
  const code = chunks.join('');
  codeCache.set(source, code);
  return code;
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

function forbiddenBlocks(source, file) {
  if (!/request photo|PHOTO_REQUIRED|APPROVED BUNCH NOTE:/i.test(source)) return;
  const code = codeOnly(source);
  if (/["'`]Take or upload at least one request photo/i.test(code)) fail(`${file}: request-photo completion block`);
  // A detector regex/catalog mentioning an incident code is not a user gate.
  if (/(?:throw\s+(?:new\s+)?(?:Error|TypeError|Object\.assign)?\s*\([^;]{0,300}|(?:showToast|errorResponse|showRequestWorkFieldValidation)\s*\([^;]{0,300})\b[A-Z_]*PHOTO_REQUIRED\b/.test(code)
    || /\b(?:code|error)\s*:\s*["'][A-Z_]*PHOTO_REQUIRED["'][^;]{0,180}\b(?:status\s*:\s*4\d\d|return\s+false)/.test(code)) fail(`${file}: PHOTO_REQUIRED action block`);
  if (/APPROVED BUNCH NOTE:/i.test(code) && /["'`][^\n]{0,4000}APPROVED BUNCH NOTE:/i.test(code)) fail(`${file}: approved Bunch Note card banner`);
}

function featureContracts(composed, engine, label = 'source') {
  const code = codeOnly(composed), reports = codeOnly(engine);
  requireMatch(reports, /aggregate\.hasLowStockCurrent[^;]+reports\[['"]low-stock['"]\]\.push\(row\)/, `${label}: Low Stock classifier missing`);
  requireMatch(reports, /if\s*\(!aggregate\.hasValidF1\)\s*reports\[['"]not-in-f1['"]\]\.push\(row\)/, `${label}: Not in F1 classifier missing`);
  requireMatch(code, /GncEvalReports/, `${label}: report engine integration missing`);
  requireMatch(code, /function\s+fieldAuditMatchingRows\s*\([^)]*\)\s*\{[\s\S]{0,1800}season\.includes\(state\.season\)[\s\S]{0,600}year>2026/, `${label}: Season Y/year filtering missing`);
  requireMatch(code, /season\s*:\s*['"]Y['"][^\n]{0,80}year\s*:\s*['"]2026max['"]/, `${label}: Season Y default missing`);
  requireMatch(code, /function\s+fieldAuditSetAnswer\s*\([^)]*\)\s*\{[\s\S]{0,2500}is_product_there[\s\S]{0,1500}fieldAuditFlush/, `${label}: product-presence persistence missing`);
  requireMatch(code, /function\s+requireReclassExplanation\s*\([^)]*\)\s*\{[\s\S]{0,1000}isReclassExplanationExempt\(\)[\s\S]{0,1000}return false/, `${label}: non-admin Reclass Explanation validation missing`);
  requireMatch(code, /if\s*\(!requireReclassExplanation\(row\.unique_id\)\)\s*throw/, `${label}: Reclass Explanation submission guard missing`);
  requireMatch(code, /function\s+resolveCanonicalInventoryRow\s*\([^)]*\)\s*\{[\s\S]{0,4500}masterInventoryById\.get[\s\S]{0,4500}noteScope/, `${label}: canonical inventory resolver missing`);
  requireMatch(code, /function\s+publishRowEvaluationToMasterAndNotes\s*\([^)]*\)\s*\{[\s\S]{0,7500}beginRowEvaluationMemoryPublication[\s\S]{0,7500}saveSecureDriveEvidence/, `${label}: canonical evaluation publisher missing`);
  requireMatch(code, /await\s+publishRowEvaluationToMasterAndNotes\(itemToSave,requestPatch/, `${label}: Request publisher integration missing`);
}

function versionContracts(version, index, worker, runtime, label) {
  const expected = String(version.version || '');
  if (!/^\d+\.\d+\.\d+$/.test(expected) || version.release !== `AgData v${expected}`) fail(`${label}: version.json invalid`);
  const escaped = expected.replaceAll('.', '\\.');
  requireMatch(index, new RegExp(`name=["']agdata-release["']\\s+content=["']${escaped}["']`), `${label}: index release mismatch`);
  for (const name of ['__APP_SHELL_VERSION__', '__APP_RELEASE_VERSION__']) requireMatch(index, new RegExp(`${name}\\s*=\\s*["']AgData v${escaped}["']`), `${label}: ${name} mismatch`);
  for (const [name, prefix] of [['APP_SHELL_BUILD','AgData v'], ['APP_ASSET_VERSION',''], ['CACHE_VERSION','agdata-v']]) requireMatch(worker, new RegExp(`const ${name}\\s*=\\s*["']${prefix}${escaped}["']`), `${label}: ${name} mismatch`);
  requireMatch(runtime, new RegExp(`const APP_VERSION\\s*=\\s*["']${escaped}["']`), `${label}: runtime version mismatch`);
  requireMatch(runtime, new RegExp(`APP_SHELL_VERSION[^;]+["']AgData v${escaped}["']`), `${label}: runtime shell fallback mismatch`);
  return expected;
}

try {
  const syntax = Promise.all(syntaxFiles.map(checkSyntax));
  const [runtime, row, index, worker, versionText, engine, files] = await Promise.all([
    read(syntaxFiles[0]), read(syntaxFiles[1]), read('index.html'), read('sw.js'), read('version.json'), read('assets/eval-reports-engine.js'),
    Promise.all(['assets', 'supabase/functions'].map(directory => sourceFiles(path.join(root, directory)))).then(groups => groups.flat()),
  ]);
  const fragments = [...runtime.matchAll(/\/\* @runtime-fragment (assets\/[a-z0-9-]+\.js) \*\//g)];
  if (!fragments.some(match => match[1] === 'assets/row-workflow-functions.js')) fail('composed runtime does not include row-workflow-functions.js');
  const fragmentSources = new Map(await Promise.all(fragments.map(async match => [match[1], match[1] === syntaxFiles[1] ? row : await read(match[1])])));
  const composed = runtime.replace(/\/\* @runtime-fragment (assets\/[a-z0-9-]+\.js) \*\//g, (_, file) => fragmentSources.get(file));
  const expected = versionContracts(JSON.parse(versionText), index, worker, runtime, 'source');
  await access(path.join(root, '.nojekyll')).catch(() => fail('source: root .nojekyll missing'));
  featureContracts(composed, engine);
  // The composed source contains every executable byte of these constituent files.
  // Check it once, then scan all remaining source files independently.
  forbiddenBlocks(composed, 'composed runtime');
  const composedFiles = new Set([syntaxFiles[0], ...fragmentSources.keys()].map(file => path.resolve(root, file)));
  await Promise.all(files.filter(file => !composedFiles.has(path.resolve(file))).map(async file => forbiddenBlocks(await readFile(file, 'utf8'), path.relative(root, file))));
  const artifactFlag = process.argv.indexOf('--artifact-root');
  if (artifactFlag >= 0) {
    if (!process.argv[artifactFlag + 1]) throw new Error('--artifact-root requires a directory');
    const artifact = path.resolve(process.argv[artifactFlag + 1]);
    const [artifactIndex, artifactWorker, artifactVersionText, artifactRuntime, artifactEngine] = await Promise.all([
      'index.html','sw.js','version.json','assets/live-app-runtime-v2026082010.min.js','assets/eval-reports-engine.js',
    ].map(file => readFile(path.join(artifact,file),'utf8')));
    const actual = versionContracts(JSON.parse(artifactVersionText),artifactIndex,artifactWorker,artifactRuntime,'Pages artifact');
    if (actual !== expected) fail('Pages artifact differs from source release');
    await access(path.join(artifact,'.nojekyll')).catch(() => fail('Pages artifact: root .nojekyll missing'));
    forbiddenBlocks(artifactRuntime,'Pages artifact runtime');
    // The minifier preserves names; enforce the same implementation contracts.
    featureContracts(artifactRuntime,artifactEngine,'Pages artifact');
  }
  await syntax;
} catch (error) { fail(error.message); }
const elapsed = performance.now() - started;
if (elapsed >= 2000) fail(`fast lock exceeded 2 seconds (${Math.round(elapsed)} ms)`);
if (errors.length) {
  console.error(`FAST REGRESSION LOCK FAILED (${Math.round(elapsed)} ms)\n${errors.map(error => `- ${error}`).join('\n')}`);
  process.exitCode = 1;
} else console.log(`FAST REGRESSION LOCK PASS (${Math.round(elapsed)} ms): syntax, forbidden blocks, core features, .nojekyll, matching versions.`);
