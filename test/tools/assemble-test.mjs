import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const testRoot = path.join(root, 'test');
const project = 'apztnscvagayslumnalr';
const production = 'kzrnyjsosryejjejliii';
const evidence = 'G:/My Drive/GNC/AgData/Release Evidence';
const credentials = JSON.parse(await fs.readFile(path.join(root, '.gnc-local/test-edge-credentials.json'), 'utf8'));
if (credentials.url !== `https://${project}.supabase.co`) throw Error('TEST_PROJECT_MISMATCH');
const catalog = JSON.parse(await fs.readFile(path.join(evidence, 'agdata-test-clone-catalog.json'), 'utf8'));
const shorten = name => name.length <= 63 ? name : name.slice(0, 50) + '_' + crypto.createHash('sha256').update(name).digest('hex').slice(0, 12);
const names = {};
for (const item of [...catalog.relations, ...catalog.functions]) if (item.schema === 'public') names[item.name] = shorten('test_' + item.name);
await fs.mkdir(path.join(testRoot, 'database'), { recursive: true });
await fs.writeFile(path.join(testRoot, 'database/namespace-map.json'), JSON.stringify(names, null, 2) + '\n');
const config = { project, anonKey: credentials.anonKey, names, environment: 'agdata-test', version: '1.0.0', recipient: 'dylan_collyge@greenleafnursery.com' };
await fs.writeFile(path.join(testRoot, 'assets/test/config.js'), 'window.AGDATA_TEST_CONFIG = Object.freeze(' + JSON.stringify(config) + ');\n');

function transform(text) {
  return text.replaceAll(production, project)
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, token => {
      try { const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')); return payload.ref === production && payload.role === 'anon' ? credentials.anonKey : token; } catch { return token; }
    })
    .replace(/(["'])(?:gnc\.local|agdata\.local|agdata\.internal|agdata\.greenleafnursery\.com)\1/g, "'agdata-test.invalid'")
    .replace(/(NATIVE_AUTH_ALIAS_DOMAIN\s*=\s*)["'][^"']+["']/g, "$1'agdata-test.invalid'")
    .replaceAll('agdata-test.invalid.invalid', 'agdata-test.invalid')
    .replace(/(["'`(])\/v2(?=[/"'`)])/g, '$1/test/v2')
    .replaceAll("next.pathname = '/';", "next.pathname = '/test/';")
    .replace(/(location\.(?:replace|assign)\(\s*['"])\/(?:index\.html)?(['"])/g, '$1/test/$2');
}
async function files(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) result.push(...await files(path.join(directory, entry.name)));
    else result.push(path.join(directory, entry.name));
  }
  return result;
}
const publicDirs = ['assets', 'components', 'services', 'utils', 'v2', 'reports'];
for (const dir of publicDirs) {
  for (const source of await files(path.join(root, '_site', dir)).catch(() => [])) {
    const relative = path.relative(path.join(root, '_site'), source);
    if (relative.replaceAll('\\', '/').startsWith('assets/test/')) continue;
    const destination = path.join(testRoot, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    if (/\.(?:js|mjs|css|html|json|svg|ts)$/.test(source)) await fs.writeFile(destination, transform(await fs.readFile(source, 'utf8')));
    else await fs.copyFile(source, destination);
  }
}
let html = transform(await fs.readFile(path.join(root, '_site/index.html'), 'utf8'));
html = html.replace(/<title>[^<]*<\/title>/, '<title>AgData Test (T)</title>')
  .replace(/<head([^>]*)>/i, '<head$1>\n<script src="./assets/test/config.js"></script>\n<script src="./assets/test/isolation.js"></script>\n<link rel="stylesheet" href="./assets/test/operations.css">')
  .replace(/\.\/sw\.js/g, './sw-test.js')
  .replace(/(rel="(?:icon|apple-touch-icon)"[^>]*href=")[^"]+/g, '$1./assets/test/icon-192.png')
  .replace('</body>', '<script type="module" src="./assets/test/operations.mjs"></script>\n</body>');
await fs.writeFile(path.join(testRoot, 'index.html'), html);
for (const file of ['version.json','deployment.json','deployment-fingerprint.json','version-parity.json']) { const donor=JSON.parse(await fs.readFile(path.join(root,'_site',file),'utf8'));await fs.writeFile(path.join(testRoot,file),JSON.stringify({...donor,environment:'agdata-test',testVersion:'1.0.0'})+'\n'); }

// Preserve source module contracts, while one fetch boundary resolves every SQL object.
for (const source of await files(path.join(root, 'supabase/functions'))) {
  const relative = path.relative(path.join(root, 'supabase/functions'), source);
  if(relative.split(path.sep)[0]==='send-push-alert')continue;
  const parts = relative.split(path.sep); if (parts[0] !== '_shared') parts[0] = 'test-' + parts[0];
  const destination = path.join(testRoot, 'supabase/functions', ...parts);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  if (/\.(ts|js|mjs|json)$/.test(source)) {
    let text = transform(await fs.readFile(source, 'utf8'));
    text = text.replace(/Deno\.env\.get\(["']APP_SESSION_SECRET["']\)/g, '(Deno.env.get("TEST_APP_SESSION_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))');
    if (relative.replaceAll('\\','/') === 'app-api/index.ts') {
      text = 'import { testDriveFetch, testSyncEnv } from "../_shared/test-drive-adapter.ts";\n' + text;
      text = text.replace(/Deno\.env\.get\("ERP_SYNC_CLOUD_WORKER_KEY"\)/g, 'Deno.env.get("TEST_ERP_SYNC_CLOUD_WORKER_KEY")');
      text = text.replace(/async function mintCloudDriveAccessToken\(\)[\s\S]*?(?=async function handleErpSyncAction)/, 'async function mintCloudDriveAccessToken() { return "test-storage"; }\n\n');
      text = text.replace(/runErpSyncWorkerStep\(\{ supabase, env: [^,]+,/, 'runErpSyncWorkerStep({ supabase, env:testSyncEnv, fetcher:testDriveFetch,');
      text = text.replace(/runProductionScheduleSyncStep\(\{[\s\S]*?\}\)/, 'runProductionScheduleSyncStep({supabase, env:testSyncEnv, fetcher:testDriveFetch, status:persist, cursor:nextCursor, accessToken})');
      text = text.replace(/      if \(nextCursor\.productionScheduleComplete !== true\) \{[\s\S]*?nextCursor = production\.cursor;\n      \}/, '      nextCursor = { ...nextCursor, productionScheduleComplete: true };');
      text = text.replace('return runSecondaryErpSyncStep({', 'return runSecondaryErpSyncStep({ fetcher:testDriveFetch,').replace('cursor: nextCursor,', 'cursor: nextCursor, operationalOnly: true,');
    }
    if (relative.replaceAll('\\','/') === '_shared/erp-secondary-sync.mjs') text=text.replaceAll('1681oPSyfz7mURdywOKH_9FQNnBQmmSWO', 'test-hl-po').replaceAll('13jQ37aqokXgzZ2z3VOOdCANdW5lQPgv2', 'test-hl-po-processed');
    text=text.replace('sourceProgress: {...jsonObject(claimStatus.sourceProgress || {}),prod_schedule:{stage:"queued",percent:0,checked:false}},','sourceProgress: {},').replace('additionalStageOrder: ["prod_schedule"],','additionalStageOrder: [],');
    // A test password/session can never authenticate against the production alias domain.
    text = text.replace(/@agdata\.internal/g, '@agdata-test.invalid');
    if (/^[^\\/]+[\\/]index\.ts$/.test(relative)) text = 'import "../_shared/test-isolation.ts";\n' + text;
    await fs.writeFile(destination, text);
  } else await fs.copyFile(source, destination);
}
for (const source of await files(path.join(root, 'services'))) {
  if (!/\.(ts|js|mjs|json)$/.test(source)) continue;
  const destination = path.join(testRoot, 'services', path.relative(path.join(root, 'services'), source));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, transform(await fs.readFile(source, 'utf8')));
}
await fs.copyFile(path.join(testRoot,'supabase/functions/test-email-worker/index.ts'),path.join(testRoot,'supabase/functions/test-request-delivery-worker/index.ts'));
await fs.writeFile(path.join(testRoot, 'supabase/functions/_shared/test-namespace.json'), JSON.stringify(names) + '\n');
for(const dir of publicDirs)for(const file of await files(path.join(testRoot,dir))){if(!file.endsWith('.html'))continue;const current=await fs.readFile(file,'utf8');if(!current.includes('assets/test/isolation.js'))await fs.writeFile(file,current.replace(/<head([^>]*)>/i,'<head$1>\n<script src="/test/assets/test/config.js"></script>\n<script src="/test/assets/test/isolation.js"></script>'));}
const nestedManifest=JSON.parse(await fs.readFile(path.join(testRoot,'v2/manifest.webmanifest'),'utf8'));Object.assign(nestedManifest,JSON.parse(await fs.readFile(path.join(testRoot,'manifest.json'),'utf8')),{icons:[{src:'/test/assets/test/icon-192.png',sizes:'192x192',type:'image/png'},{src:'/test/assets/test/icon-512.png',sizes:'512x512',type:'image/png'}]});await fs.writeFile(path.join(testRoot,'v2/manifest.webmanifest'),JSON.stringify(nestedManifest)+'\n');
console.log(JSON.stringify({ assembled: true, databaseObjects: Object.keys(names).length, target: project }));
