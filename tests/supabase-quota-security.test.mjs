import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { readComposedRuntimeSource } from '../scripts/composed-app-source.mjs';
import { applyScopedMigrationWithSupabaseCli, agdataV23130QuotaSecurityMigrationName } from '../scripts/apply-item-low-stock-migration.mjs';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
function functions(file, names, context = {}) {
  const source = file === 'assets/app-runtime.js' ? readComposedRuntimeSource() : read(file);
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found = new Map();
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name) found.set(node.name.text, node.getText(tree)); ts.forEachChild(node, visit); }
  visit(tree);
  const code = names.map(name => { assert.ok(found.has(name), name); return found.get(name).replace(/^export /, ''); }).join('\n');
  const sandbox = vm.createContext({ URL, Request, Response, ...context });
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, sandbox);
  return sandbox;
}

test('public photo URLs retain objects and unrelated query values without transformations', () => {
  const runtime = functions('assets/app-runtime.js', ['isSupabaseStorageHost', 'getSupabaseStorageOriginalUrl', 'normalizeStoragePublicUrl'], {
    window: { location: { href: 'https://agmetricapp.com/' } }, SUPABASE_STORAGE_TRANSFORM_PARAMS: new Set(['width','height','resize','quality','format']),
  });
  const worker = functions('sw.js', ['normalizeStoragePhotoRequest']);
  for (const route of ['render/image', 'object']) {
    const input = `https://example.supabase.co/storage/v1/${route}/public/photos/a.jpg?width=320&height=80&resize=cover&quality=50&format=webp&v=receipt`;
    const expected = 'https://example.supabase.co/storage/v1/object/public/photos/a.jpg?v=receipt';
    assert.equal(runtime.normalizeStoragePublicUrl(input), expected);
    assert.equal(worker.normalizeStoragePhotoRequest(new Request(input)).url, expected);
  }
});

test('photo cache hits avoid fetch and LRU evicts the oldest entry at 501', async () => {
  const entries = new Map(); let fetches = 0; const waits = [];
  const metadata = { entries: {} };
  const cache = { match: async request => entries.get(request.url)?.clone(), put: async (request,response) => entries.set(request.url,response.clone()),
    keys: async () => [...entries.keys()].map(url => new Request(url)), delete: async request => entries.delete(request.url) };
  const ctx = functions('sw.js', ['normalizeStoragePhotoRequest','handleRuntimeImageRequest','pruneRuntimeImageCache'], {
    IMAGE_CACHE_NAME: 'agdata-photo-cache-v1', IMAGE_CACHE_MAX_ENTRIES: 500, IMAGE_CACHE_MAX_BYTES: 1e9,
    IMAGE_CACHE_MAX_AGE_MS: 1e12, OPAQUE_IMAGE_ESTIMATED_BYTES: 10, runtimeImageCacheQueue: Promise.resolve(),
    caches: { open: async () => cache }, shouldBypassServiceWorkerCache: () => false,
    readImageCacheMetadata: async () => metadata, writeImageCacheMetadata: async () => {}, matchRootCache: async () => null,
    fetch: async () => { fetches++; return new Response('photo'); },
  });
  const request = new Request('https://example.supabase.co/storage/v1/render/image/public/photos/a?width=300');
  const event = { request, waitUntil: promise => waits.push(promise) };
  await ctx.handleRuntimeImageRequest(event); await Promise.all(waits);
  await ctx.handleRuntimeImageRequest(event); await Promise.all(waits);
  assert.equal(fetches, 1); assert.equal(entries.size, 1);
  for (let i=0;i<500;i++) { const url=`https://example.supabase.co/storage/v1/object/public/photos/${i}`; entries.set(url,new Response('p')); metadata.entries[url]={cachedAt:Date.now()-1000-i,size:1}; }
  await ctx.pruneRuntimeImageCache(cache, metadata);
  assert.equal(entries.size, 500);
  assert.ok(entries.has('https://example.supabase.co/storage/v1/object/public/photos/a'));
  assert.equal(entries.has('https://example.supabase.co/storage/v1/object/public/photos/499'), false);
});

test('origin shield rejects spoofing while allowing production, local preview and signed originless clients', () => {
  const ctx = functions('supabase/functions/app-api/index.ts', ['isAllowedAppOrigin']);
  for (const origin of ['https://agmetricapp.com','https://www.agmetricapp.com','https://org.github.io','http://127.0.0.1:4173','http://localhost:4173',null]) assert.equal(ctx.isAllowedAppOrigin(origin),true,origin);
  for (const origin of ['null','https://agmetricapp.com.evil.test','https://github.io.evil.test','https://evil@agmetricapp.com','http://agmetricapp.com','https://agmetricapp.com/path']) assert.equal(ctx.isAllowedAppOrigin(origin),false,origin);
});

test('closed or hidden progress UI never permits background polling', () => {
  const modal = { hidden:false, classList:{contains:()=>false}, style:{display:'flex'} };
  const document = {hidden:false,getElementById:()=>modal};
  const ctx = functions('assets/app-runtime.js',['isQuotaBackgroundPollingAllowed'],{document});
  assert.equal(ctx.isQuotaBackgroundPollingAllowed(),true);
  document.hidden=true; assert.equal(ctx.isQuotaBackgroundPollingAllowed(),false);
  document.hidden=false;modal.style.display='none';assert.equal(ctx.isQuotaBackgroundPollingAllowed(),false);
  document.getElementById=()=>null;assert.equal(ctx.isQuotaBackgroundPollingAllowed(),false);
});

test('empty existing CI receipt passes installed-contract verification; missing contract still fails', async () => {
  const source=read('supabase/migrations/'+agdataV23130QuotaSecurityMigrationName); const calls=[];
  const query=async sql=>{calls.push(sql);return [{release_migration_state:{prior:{name:'v23130_supabase_quota_and_rls_security',statements:[]}}}];};
  const result=await applyScopedMigrationWithSupabaseCli({source,targetMigrationName:agdataV23130QuotaSecurityMigrationName,query});
  assert.equal(result.status,'already_applied');assert.equal(calls.length,2);
  assert.match(calls[1],/LOW_STOCK_DATABASE_CONTRACT_MISSING/);assert.match(calls[1],/security_invoker=true/);
  await assert.rejects(applyScopedMigrationWithSupabaseCli({source,targetMigrationName:agdataV23130QuotaSecurityMigrationName,
    query:async sql=>sql.includes('release_migration_state')?query(sql):Promise.reject(new Error('LOW_STOCK_DATABASE_CONTRACT_MISSING'))}),/CONTRACT_MISSING/);
});

test('production watchdog stays in memory and attempts at most one fatal report', async () => {
  const reports=[]; const writes=[];
  const document={hidden:false,body:{dataset:{currentView:'home'},querySelectorAll:()=>[]},documentElement:null,querySelector:()=>null,getElementById:()=>null,addEventListener(){}};
  const window={__APP_RELEASE_VERSION__:'AgData v2.3.130',localStorage:{getItem:()=>null,setItem:(...args)=>writes.push(args),removeItem(){}},setTimeout,clearTimeout,addEventListener(){}};
  vm.runInNewContext(read('assets/runtime-watchdog.js'),{window,document,MutationObserver:class{observe(){}},setTimeout,clearTimeout,console});
  window.GncRuntimeWatchdog.configure({memoryOnly:true,username:'dylan_collyge',role:'super-admin',reportEvent:async event=>{reports.push(event);return {ok:true};}});
  window.GncRuntimeWatchdog.record('VIEW_LOAD_STALL');
  window.GncRuntimeWatchdog.record('UNHANDLED_JS_EXCEPTION',{error_message:'private payload'});
  window.GncRuntimeWatchdog.record('UNHANDLED_PROMISE_REJECTION');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reports.length,1);assert.equal(writes.length,0);assert.equal(reports[0].error_message,'UNHANDLED_JS_EXCEPTION');
});
