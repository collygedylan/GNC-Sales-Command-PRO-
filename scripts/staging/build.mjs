import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { ancestor, simple } from 'acorn-walk';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_CONFIG = path.join(root, 'scripts/staging/staging-config.json');
const STORAGE_PREFIX = 'gnc_teardown_staging_v1:';

function invariant(condition, message) { if (!condition) throw new Error(`STAGING_BUILD: ${message}`); }

function applyEdits(source, edits) {
  const ordered = [...edits].sort((a, b) => b.start - a.start);
  let boundary = source.length;
  for (const edit of ordered) {
    invariant(edit.start >= 0 && edit.end <= boundary && edit.start <= edit.end, 'overlapping or invalid source edits');
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    boundary = edit.start;
  }
  return source;
}

function propertyName(node) {
  if (!node) return '';
  const property = node.type === 'Property' ? node.key : node.property;
  if (!node.computed && property?.type === 'Identifier') return property.name;
  if (!node.computed && property?.type === 'Literal') return String(property.value);
  if (node.computed && property?.type === 'Literal') return String(property.value);
  return '';
}

function storageKind(node) {
  if (node?.type === 'Identifier' && ['localStorage', 'sessionStorage'].includes(node.name)) return node.name;
  if (node?.type === 'MemberExpression' && ['localStorage', 'sessionStorage'].includes(propertyName(node))) return propertyName(node);
  return '';
}

function isIndexedDb(node) {
  return node?.type === 'Identifier' && node.name === 'indexedDB'
    || node?.type === 'MemberExpression' && propertyName(node) === 'indexedDB';
}

function isCacheStorage(node) {
  return node?.type === 'Identifier' && node.name === 'caches'
    || node?.type === 'MemberExpression' && propertyName(node) === 'caches';
}

function quote(value) { return JSON.stringify(value); }
function namespacedKey(expression) { return `${quote(STORAGE_PREFIX)}+String(${expression || "''"})`; }

function storageLengthExpression(kind) {
  return `(()=>{let n=0;for(let i=0;i<${kind}.length;i++){if(String(${kind}.key(i)||'').startsWith(${quote(STORAGE_PREFIX)}))n++}return n})()`;
}

function storageKeyExpression(kind, index) {
  return `(()=>{let n=-1;for(let i=0;i<${kind}.length;i++){const k=${kind}.key(i);if(String(k||'').startsWith(${quote(STORAGE_PREFIX)})&&++n===Number(${index}))return k.slice(${quote(STORAGE_PREFIX.length)})}return null})()`;
}

function storageClearExpression(kind) {
  return `(()=>{for(let i=${kind}.length-1;i>=0;i--){const k=${kind}.key(i);if(String(k||'').startsWith(${quote(STORAGE_PREFIX)}))${kind}.removeItem(k)}})()`;
}

export function namespaceStorageReferences(source, { sourceType = 'script' } = {}) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType, allowAwaitOutsideFunction: true });
  const edits = [];
  simple(ast, {
    CallExpression(node) {
      const callee = node.callee;
      if (callee?.type !== 'MemberExpression') return;
      const kind = storageKind(callee.object);
      const method = propertyName(callee);
      if (kind) {
        if (method === 'clear') edits.push({ start: node.start, end: node.end, text: storageClearExpression(kind) });
        else if (method === 'key') edits.push({ start: node.start, end: node.end, text: storageKeyExpression(kind, node.arguments[0]?.start !== undefined ? source.slice(node.arguments[0].start, node.arguments[0].end) : '0') });
        else if (['getItem', 'setItem', 'removeItem'].includes(method) && node.arguments.length) {
          const first = node.arguments[0];
          edits.push({ start: first.start, end: first.end, text: namespacedKey(source.slice(first.start, first.end)) });
        }
        return;
      }
      if (method === 'open' || method === 'deleteDatabase') {
        if (isIndexedDb(callee.object) && node.arguments.length) {
          const arg = node.arguments[0];
          edits.push({ start: arg.start, end: arg.end, text: namespacedKey(source.slice(arg.start, arg.end)) });
        }
      }
      const caches = isCacheStorage(callee.object);
      if (caches && ['open', 'delete', 'has'].includes(method) && node.arguments.length) {
        const arg = node.arguments[0];
        edits.push({ start: arg.start, end: arg.end, text: namespacedKey(source.slice(arg.start, arg.end)) });
      }
      if (caches && method === 'keys') {
        edits.push({ start: node.start, end: node.end,
          text: `(${source.slice(node.start, node.end)}).then(keys=>keys.filter(k=>k.startsWith(${quote(STORAGE_PREFIX)})).map(k=>k.slice(${quote(STORAGE_PREFIX.length)})))` });
      }
    },
    MemberExpression(node) {
      const kind = storageKind(node.object);
      if (kind && propertyName(node) === 'length') edits.push({ start: node.start, end: node.end, text: storageLengthExpression(kind) });
    },
  });
  return applyEdits(source, edits);
}

function findFunction(ast, name) {
  const nodes = [];
  simple(ast, {
    FunctionDeclaration(node) { if (node.id?.name === name) nodes.push(node); },
  });
  invariant(nodes.length === 1, `expected one ${name} declaration, found ${nodes.length}`);
  return nodes[0];
}

function findConstant(ast, name) {
  const nodes = [];
  simple(ast, {
    VariableDeclarator(node) { if (node.id?.type === 'Identifier' && node.id.name === name) nodes.push(node); },
  });
  invariant(nodes.length === 1, `expected one ${name} constant, found ${nodes.length}`);
  return nodes[0];
}

function replaceFunctionBody(ast, edits, name, body) {
  const node = findFunction(ast, name);
  edits.push({ start: node.body.start + 1, end: node.body.end - 1, text: body });
}

function disableUnsupportedStagingFeatures(source) {
  if (!source.includes('function canViewBloomscapesPendingOrders')) {
    invariant(!/kzrnyjsosryejjejliii\.supabase\.co|bloomscapes_pending_command/i.test(source), 'staging feature boundary changed and cannot be safely disabled');
    return source;
  }
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script', allowAwaitOutsideFunction: true });
  const edits = [];
  replaceFunctionBody(ast, edits, 'canViewBloomscapesPendingOrders', 'return false;');
  replaceFunctionBody(ast, edits, 'loadBloomscapesPendingOrders', "bloomscapesPendingState.loading=false;bloomscapesPendingState.error='This workflow is not enabled in the focused staging sandbox.';renderBloomscapesPendingOrders();return false;");
  replaceFunctionBody(ast, edits, 'getShellServiceWorkerRegistration', 'return null;');
  replaceFunctionBody(ast, edits, 'updateShellServiceWorkerRegistration', 'return null;');
  replaceFunctionBody(ast, edits, 'clearShellControllerCachesAndRegistrations', "if('caches' in window){const keys=await caches.keys();for(const key of keys)await caches.delete(key)}return true;");
  const pendingFeatures = [];
  simple(ast, { Property(node) { if (propertyName(node) === 'side:pendingOrders') pendingFeatures.push(node); } });
  invariant(pendingFeatures.length === 1, `expected one pending-order side-load entry, found ${pendingFeatures.length}`);
  edits.push({ start: pendingFeatures[0].start, end: pendingFeatures[0].end,
    text: "'side:pendingOrders':{enabled:()=>false,scope:()=>'',stage:async()=>{throw new Error('TEARDOWN_MODULE_UNAVAILABLE')},commit:()=>{}}" });
  const registrationStatements = [];
  const workerReadyReferences = [];
  ancestor(ast, {
    CallExpression(node, ancestors) {
      const callee = node.callee;
      if (propertyName(callee) !== 'register' || propertyName(callee.object) !== 'serviceWorker'
          || callee.object?.object?.type !== 'Identifier' || callee.object.object.name !== 'navigator') return;
      const statement = [...ancestors].reverse().find((entry) => entry.type === 'ExpressionStatement');
      if (statement) registrationStatements.push(statement);
    },
    MemberExpression(node) {
      if (propertyName(node) === 'ready' && propertyName(node.object) === 'serviceWorker'
          && node.object?.object?.type === 'Identifier' && node.object.object.name === 'navigator') workerReadyReferences.push(node);
    },
  });
  invariant(registrationStatements.length <= 1, `multiple service worker registration statements found (${registrationStatements.length})`);
  for (const statement of registrationStatements) edits.push({ start: statement.start, end: statement.end, text: 'void 0;' });
  for (const reference of workerReadyReferences) edits.push({ start: reference.start, end: reference.end, text: "Promise.reject(new Error('TEARDOWN_SERVICE_WORKER_DISABLED'))" });
  let transformed = applyEdits(source, edits);
  const sandboxHostPattern = new URL('https://apztnscvagayslumnalr.supabase.co').hostname.replaceAll('.', '\\.');
  transformed = transformed.replaceAll('kzrnyjsosryejjejliii\\.supabase\\.co', sandboxHostPattern);
  invariant(!/kzrnyjsosryejjejliii\.supabase\.co|bloomscapes_pending_command/i.test(transformed), 'unsupported production feature endpoint remained in runtime');
  invariant(!/navigator\.serviceWorker\.(?:getRegistrations|unregister|register)\s*\(/.test(transformed), 'unsafe service worker mutation remained in runtime');
  return transformed;
}

function stagingBridge() {
  return `const __gncStageFetch=(input,init,fallback)=>new Promise((resolve,reject)=>{let claimed=false,done=false;const finish=(work)=>{if(done)return;done=true;Promise.resolve(work).then(resolve,reject)};const detail={input,init,respond:value=>{claimed=true;Promise.resolve(value).then(response=>response===null?detail.continue():finish(response),reject)},continue:()=>finish(Promise.resolve().then(fallback))};window.dispatchEvent(new CustomEvent('gnc:staging-fetch',{detail}));if(!claimed)detail.continue()});`;
}

export function transformRuntime(source, config) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  const edits = [];
  const values = {
    SUPABASE_URL: config.sandboxUrl.replace(/\/$/, ''),
    SUPABASE_KEY: config.publishableKey,
    GOOGLE_SCRIPT_URL: `${config.sandboxUrl.replace(/\/$/, '')}/functions/v1/teardown-api?legacy_delivery=email`,
    APP_API_FUNCTION_URL: `${config.sandboxUrl.replace(/\/$/, '')}/functions/v1/teardown-api`,
    NATIVE_AUTH_ALIAS_DOMAIN: 'teardown.example.invalid',
  };
  for (const [name, value] of Object.entries(values)) {
    const node = findConstant(ast, name);
    edits.push({ start: node.init.start, end: node.init.end, text: quote(value) });
  }
  const emailSender = findFunction(ast, 'postGoogleScriptRawJsonPayload');
  const emailCalls = [];
  simple(emailSender.body, {
    CallExpression(node) {
      if (node.callee?.name !== 'fetchWithTimeout'
          || node.arguments[0]?.type !== 'Identifier'
          || node.arguments[0].name !== 'GOOGLE_SCRIPT_URL'
          || node.arguments[1]?.type !== 'ObjectExpression') return;
      emailCalls.push(node.arguments[1]);
    },
  });
  invariant(emailCalls.length === 1, `expected one legacy email transport call, found ${emailCalls.length}`);
  const emailInit = emailCalls[0];
  invariant(!emailInit.properties.some((property) => propertyName(property) === 'headers'), 'legacy email transport already defines headers; review staging auth seam');
  edits.push({ start: emailInit.end - 1, end: emailInit.end - 1, text: ",headers:await getNativeAuthRequestHeaders()" });
  const fetcher = findFunction(ast, 'fetchWithTimeout');
  edits.push({ start: fetcher.body.start + 1, end: fetcher.body.start + 1, text: stagingBridge() });
  simple(fetcher.body, {
    ReturnStatement(node) {
      if (node.argument?.type !== 'AwaitExpression') return;
      const awaited = node.argument.argument;
      if (awaited?.type !== 'LogicalExpression' || awaited.operator !== '??') return;
      if (awaited.right?.type !== 'CallExpression' || awaited.right.callee?.name !== 'fetch') return;
      const requestArgs = awaited.right.arguments.map((arg) => source.slice(arg.start, arg.end)).join(',');
      const fallback = source.slice(awaited.start, awaited.end);
      edits.push({ start: node.argument.start, end: node.argument.end, text: `await __gncStageFetch(${requestArgs},()=>(${fallback}))` });
    },
  });
  invariant(edits.filter((edit) => edit.text.startsWith('await __gncStageFetch')).length === 1, 'fetchWithTimeout transport seam changed');
  const clientFactory = findFunction(ast, 'getSupabaseBrowserClient');
  const clients = [];
  simple(clientFactory.body, {
    Property(node) { if (propertyName(node) === 'fetch' && node.value?.type === 'ArrowFunctionExpression') clients.push(node); },
  });
  invariant(clients.length === 1, 'Supabase client fetch seam changed');
  const client = clients[0];
  edits.push({ start: client.value.start, end: client.value.end,
    text: `(input,init)=>fetchWithTimeout(input,init,30000,'Staging Supabase client')` });
  const storageKeys = [];
  simple(clientFactory.body, { Property(node) { if (propertyName(node) === 'storageKey' && node.value?.type === 'Literal') storageKeys.push(node); } });
  invariant(storageKeys.length === 1, 'Supabase auth storage seam changed');
  edits.push({ start: storageKeys[0].value.start, end: storageKeys[0].value.end, text: quote(`${STORAGE_PREFIX}teardown_auth_v1`) });
  const directEmails = [];
  simple(ast, {
    CallExpression(node) { if (node.callee?.name === 'fetch' && node.arguments[0]?.type === 'Identifier' && node.arguments[0].name === 'GOOGLE_SCRIPT_URL') directEmails.push(node); },
  });
  for (const node of directEmails) {
    const args = node.arguments.map((arg) => source.slice(arg.start, arg.end)).join(',');
    edits.push({ start: node.start, end: node.end, text: `fetchWithTimeout(${args},30000,'Captured staging email')` });
  }
  let transformed = disableUnsupportedStagingFeatures(applyEdits(source, edits));
  invariant(!/kzrnyjsosryejjejliii\.supabase\.co|script\.google\.com|agmetricapp\.com/i.test(transformed), 'unapproved production endpoint remained in runtime');
  return transformed;
}

function transformInlineScripts(html) {
  return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (tag, attributes, body) => {
    if (/\bsrc\s*=|type\s*=\s*["'](?:application\/json|text\/plain)/i.test(attributes) || !/\b(?:localStorage|sessionStorage|indexedDB|caches)\b/.test(body)) return tag;
    try { return `<script${attributes}>${namespaceStorageReferences(body)}</script>`; }
    catch (error) { throw new Error(`STAGING_BUILD: unable to namespace inline script storage (${error.message})`); }
  });
}

async function namespaceFirstPartyAssets(assetsDir) {
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'vendor') await visit(target);
      } else if (/\.(?:m?js)$/i.test(entry.name)) {
        const source = await readFile(target, 'utf8');
        let transformed = source;
        if (/\b(?:localStorage|sessionStorage|indexedDB|caches)\b/.test(source)) {
          try { transformed = namespaceStorageReferences(source); }
          catch (scriptError) {
            try { transformed = namespaceStorageReferences(source, { sourceType: 'module' }); }
            catch { throw scriptError; }
          }
          await writeFile(target, transformed, 'utf8');
        }
        invariant(!/kzrnyjsosryejjejliii\.supabase\.co|script\.google\.com|agmetricapp\.com/i.test(transformed), `unapproved production endpoint remained in first-party asset ${entry.name}`);
      }
    }
  }
  await visit(assetsDir);
}

function safeInlineJson(value) { return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026'); }

function validateConfig(config, commitSha) {
  const sandbox = new URL(config.sandboxUrl);
  const app = new URL(config.appOrigin);
  invariant(sandbox.protocol === 'https:' && sandbox.hostname === 'apztnscvagayslumnalr.supabase.co', 'sandbox URL is not allowlisted');
  invariant(app.protocol === 'https:' && config.appOrigin === 'https://collygedylan.github.io'
    && config.basePath === '/gnc-teardown-staging/staging/', 'staging Pages origin or repository path is not the approved destination');
  invariant(/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(config.publishableKey), 'only a sandbox publishable key is accepted');
  invariant(/^[0-9a-f]{40}$/i.test(commitSha), 'an explicit full 40-character commit SHA is required');
  return { ...config, commitSha: commitSha.toLowerCase() };
}

async function compiledRuntimeName(html) {
  const loaders = [...html.matchAll(/\bruntime\.src\s*=\s*['"]\.\/assets\/([^/'"?]+\.js)(?:\?[^'"]*)?['"]/g)];
  invariant(loaders.length === 1, `expected one generated live runtime loader, found ${loaders.length}`);
  const runtimeName = loaders[0][1];
  invariant(runtimeName.startsWith('live-app-runtime-'), 'generated runtime loader did not reference the live app runtime');
  const scriptPreloads = [...html.matchAll(/<link\b(?=[^>]*\brel=["']preload["'])(?=[^>]*\bas=["']script["'])[^>]*>/gi)]
    .map(([tag]) => tag.match(/\bhref=["']\.\/assets\/([^/'"?]+\.js)(?:\?[^'"]*)?["']/i)?.[1] || '');
  invariant(scriptPreloads.length <= 1 && scriptPreloads.every((preload) => preload === runtimeName),
    'generated live runtime script preload does not match the loader');
  return runtimeName;
}

async function removeProductionPwaArtifacts(directory) {
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (/^(?:sw|service-worker)\.js$|^manifest\.(?:json|webmanifest)$|^Code\.gs$|^CNAME$|^OneSignalSDK(?:Updater)?Worker\.js$/i.test(entry.name)) await rm(target, { force: true });
    }
  }
  await visit(directory);
}

async function validateSourceEntrypoints(directory) {
  async function visit(current, relative = '') {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const childRelative = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) {
        await visit(path.join(current, entry.name), childRelative);
      } else if (/\.html?$/i.test(entry.name)) {
        const excludedLegacyTree = /^(?:v2|reports)\//i.test(childRelative);
        invariant(childRelative === 'index.html' || excludedLegacyTree,
          `unexpected HTML entrypoint in release artifact: ${childRelative}`);
      }
    }
  }
  await visit(directory);
}

async function copyReviewedShell(sourceSite, outputDir) {
  await cp(path.join(sourceSite, 'index.html'), path.join(outputDir, 'index.html'));
  const assets = path.join(sourceSite, 'assets');
  const assetEntries = await readdir(assets);
  invariant(assetEntries.length > 0, 'compiled shell assets directory is empty');
  await cp(assets, path.join(outputDir, 'assets'), { recursive: true });
  // The shell references root-level brand images. Keep those static pixels,
  // while excluding additional app entrypoints and deployment metadata.
  for (const entry of await readdir(sourceSite, { withFileTypes: true })) {
    if (entry.isFile() && /\.(?:png|jpe?g|webp|gif|svg|ico)$/i.test(entry.name)) {
      await cp(path.join(sourceSite, entry.name), path.join(outputDir, entry.name));
    }
  }
}

async function rejectProductionReferences(directory) {
  const endpoint = /kzrnyjsosryejjejliii\.supabase\.co|script\.google\.com|agmetricapp\.com/i;
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
      } else if (/\.(?:html?|m?js|json|css|webmanifest|svg|map)$/i.test(entry.name)) {
        const contents = await readFile(target, 'utf8');
        invariant(!endpoint.test(contents), `unapproved production endpoint remained in staged executable/config file ${path.relative(directory, target)}`);
      }
    }
  }
  await visit(directory);
}

function injectStagingMarkup(html, config) {
  invariant((html.match(/<\/head>/gi) || []).length === 1, 'compiled shell must have one head close tag');
  const pathPrefix = config.basePath;
  const sandboxOrigin = new URL(config.sandboxUrl).origin;
  const directives = `default-src 'self'; connect-src 'self' ${sandboxOrigin}/auth/v1/ ${sandboxOrigin}/functions/v1/teardown-api ${sandboxOrigin}/storage/v1/object/upload/sign/teardown-photos/ ${sandboxOrigin}/storage/v1/object/sign/teardown-photos/; img-src 'self' data: blob: ${sandboxOrigin}/storage/v1/object/sign/teardown-photos/; font-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; form-action 'self'; base-uri 'self'`;
  invariant((html.match(/<head\b[^>]*>/gi) || []).length === 1, 'compiled shell must have one head opening tag');
  const policy = `<meta http-equiv="Content-Security-Policy" content="${directives}"><meta name="referrer" content="no-referrer">`;
  const assets = `<link rel="stylesheet" href="${pathPrefix}assets/staging.css"><script type="application/json" id="gnc-staging-config">${safeInlineJson(config)}</script><script type="module" src="${pathPrefix}assets/staging-entry.mjs"></script>`;
  return html.replace(/(<head\b[^>]*>)/i, `$1${policy}`).replace('</head>', `${assets}</head>`);
}

export async function buildStagingSite({ siteDir, outputDir, configPath = DEFAULT_CONFIG, commitSha, repoRoot = root }) {
  invariant(path.resolve(outputDir) === path.join(repoRoot, '_staging', 'staging'), 'output must be the isolated _staging/staging directory');
  const config = validateConfig(JSON.parse(await readFile(configPath, 'utf8')), commitSha);
  const sourceSite = path.resolve(siteDir);
  invariant(sourceSite !== path.resolve(outputDir) && sourceSite.startsWith(path.resolve(repoRoot)), 'input must be a repository site artifact');
  await readdir(sourceSite);
  await validateSourceEntrypoints(sourceSite);
  await mkdir(path.dirname(outputDir), { recursive: true });
  await mkdir(outputDir, { recursive: false });
  await copyReviewedShell(sourceSite, outputDir);
  await removeProductionPwaArtifacts(outputDir);
  const htmlPath = path.join(outputDir, 'index.html');
  let html = await readFile(htmlPath, 'utf8');
  const runtimeName = await compiledRuntimeName(html);
  const runtimePath = path.join(outputDir, 'assets', runtimeName);
  const runtimeSource = await readFile(runtimePath, 'utf8');
  await writeFile(runtimePath, `${transformRuntime(runtimeSource, config)}\n`, 'utf8');
  await namespaceFirstPartyAssets(path.join(outputDir, 'assets'));
  html = transformInlineScripts(html)
    .replaceAll(/<link\b[^>]*\brel=["']manifest["'][^>]*>/gi, '')
    .replaceAll(/<link\b[^>]*\brel=["']preconnect["'][^>]*kzrnyjsosryejjejliii\.supabase\.co[^>]*>/gi, '');
  invariant(!/kzrnyjsosryejjejliii\.supabase\.co|script\.google\.com|agmetricapp\.com/i.test(html), 'production backend reference remained in the staged shell');
  html = injectStagingMarkup(html, config);
  await writeFile(htmlPath, html, 'utf8');
  await cp(path.join(repoRoot, 'scripts/staging/adapter.mjs'), path.join(outputDir, 'assets/staging-adapter.mjs'));
  await cp(path.join(repoRoot, 'scripts/staging/entry.mjs'), path.join(outputDir, 'assets/staging-entry.mjs'));
  await cp(path.join(repoRoot, 'scripts/staging/staging.css'), path.join(outputDir, 'assets/staging.css'));
  await rejectProductionReferences(outputDir);
  return { outputDir: path.resolve(outputDir), runtimeName, commitSha: config.commitSha };
}

async function cli() {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    if (!key.startsWith('--') || !process.argv[index + 1]) throw new Error('Usage: node scripts/staging/build.mjs --site _site --out _staging/staging --config scripts/staging/staging-config.json --sha <commit>');
    args.set(key.slice(2), process.argv[++index]);
  }
  const siteDir = path.resolve(root, args.get('site') || '_site');
  const outputDir = path.resolve(root, args.get('out') || '_staging/staging');
  const configPath = path.resolve(root, args.get('config') || DEFAULT_CONFIG);
  const commitSha = args.get('sha') || process.env.GITHUB_SHA || '';
  const result = await buildStagingSite({ siteDir, outputDir, configPath, commitSha, repoRoot: root });
  process.stdout.write(`Staging site ready: ${result.outputDir} (${result.runtimeName}, ${result.commitSha.slice(0, 12)})\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await cli();
