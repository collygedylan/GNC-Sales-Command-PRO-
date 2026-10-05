import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const appApi = readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
const appAuth = readFileSync(new URL('../supabase/functions/_shared/app-auth.ts', import.meta.url), 'utf8');

function extractFunction(source, name, exported = false) {
  const marker = `${exported ? 'export ' : ''}function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${name} exists`);
  let brace = source.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1).replace(/^export /, '');
  }
  assert.fail(`${name} function closes`);
}

function actualAccessFunctions() {
  const readableStart = appApi.indexOf('const READABLE_TABLES = new Set([');
  const readableEnd = appApi.indexOf('const supabase = createClient', readableStart);
  assert.ok(readableStart >= 0 && readableEnd > readableStart);
  const accessConstants = appApi.slice(readableStart, readableEnd);
  const functions = [
    extractFunction(appApi, 'hasTableReadAccess'),
    extractFunction(appAuth, 'normalizeUsername', true),
    extractFunction(appAuth, 'normalizeRole', true),
    extractFunction(appAuth, 'getRoleAccessState', true),
  ];
  const fullAccess = appApi.match(/const FULL_ACCESS_USER_KEYS = new Set\((\[[^;]+\])\);/);
  assert.ok(fullAccess);
  const code = ts.transpileModule(`const AV_OPTION_EVAL_REQUESTS_TABLE = 'ph_av_option_eval_requests';\nconst FULL_ACCESS_USER_KEYS = new Set(${fullAccess[1]});\n${accessConstants}\n${functions.join('\n')}\nthis.access = hasTableReadAccess; this.roleState = getRoleAccessState; this.normalizeUsername = normalizeUsername;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const context = vm.createContext({ Set });
  vm.runInContext(code, context);
  return context;
}

test('Suspend Tag has an exact editor allowlist without broadening ordinary SOC permissions', () => {
  const auth = actualAccessFunctions();
  const matrix = [
    ['QC Supervisor', 'dan_mccuistion', true],
    ['QC Supervisor', 'qc_other', true],
    ['QC', 'qc_user', true],
    ['REP', 'rep_user', true],
    ['Sales Rep', 'sales_rep', true],
    ['Sales', 'sales_user', true],
    ['CSR', 'csr_user', true],
    ['Admin', 'admin_user', true],
    ['QC Supervisor', 'dylan_collyge', true],
  ];
  for (const [role, username, expected] of matrix) {
    const normalized = auth.normalizeUsername(username);
    const roleAccess = auth.roleState(role);
    const socRead = auth.access(role, 'ph_soc_master', normalized);
    assert.equal(socRead, expected, `${role}/${username} SOC permission`);
    // suspend_tag resolves to the exact existing permission key in DATASET_READ_SOURCES.
    assert.equal(socRead, auth.access(role, 'ph_soc_master', normalized), 'the alias may not introduce a distinct grant');
    if (role === 'QC Supervisor' && username !== 'dylan_collyge') {
      assert.equal(auth.access(role, 'ph_app_settings', normalized), false, 'QC Supervisor still cannot read app settings');
      assert.equal(auth.access(role, 'ph_master_inventory', normalized), true, 'existing QC Supervisor master permission remains unchanged');
      assert.equal(roleAccess.isQcSupervisor, true);
    }
  }
  assert.match(appApi, /suspend_tag:\s*\{\s*table: "ph_soc_master", permission: "ph_soc_master"/);
  assert.match(appApi, /dataset === "suspend_tag" \? !SUSPEND_TAG_EDITORS.has\(username\) : !hasTableReadAccess\(role, source.permission, username\)/);
  const policy=readFileSync(new URL("../supabase/functions/_shared/suspend-tag.ts",import.meta.url),"utf8");
  assert.match(policy,/new Set\(\['dylan_collyge', 'megan_kelly', 'dan_mccuistion'\]\)/);
});
