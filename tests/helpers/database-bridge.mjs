import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
let exports;
let restExports;
function databaseRestModule() {
  if (!restExports) {
    const bundle = buildSync({ absWorkingDir: root, entryPoints: ['services/databaseRest.ts'], bundle: true,
      platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
    restExports = module.exports;
  }
  return restExports;
}
export function databaseBridge(fetcher) {
  if (!exports) {
    const bundle = buildSync({ absWorkingDir: root, entryPoints: ['services/liveDatabase.ts'], bundle: true,
      platform: 'node', format: 'cjs', write: false, external: ['@supabase/supabase-js'], logLevel: 'silent' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
    exports = module.exports;
  }
  return exports.createLegacyDatabaseBridge(fetcher);
}
export function appApiDatabaseBridge(fetcher) {
  const rest = databaseRestModule();
  return rest.createDatabaseRestBridge(fetcher, rest.legacyDatabaseTableAliases);
}
export function installDatabaseBridge(context) {
  context.window ||= {};
  context.window.GncDatabase = databaseBridge((...args) => context.fetchWithTimeout(...args));
  return context;
}
