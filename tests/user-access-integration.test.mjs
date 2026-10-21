import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = readComposedAppSource();
const body = source.slice(source.indexOf('        function canonicalFeaturePermission('), source.indexOf('        function configureCanonicalUserAccess('));

function resolve(state, override = '') {
    const context = vm.createContext({
        currentUser: 'annette_hancock', nativeAuthProfile: { id: 'account-a', username: 'annette_hancock' },
        normalizeMovesUserKey: value => String(value).trim().toLowerCase(),
        window: { GncUserAccessControl: { getEffectiveUserPermissions: () => state, getSelfState: () => ({ denied: state.denied === true }) } }
    });
    vm.runInContext(body, context);
    return context.canonicalFeaturePermission('can_access_av', override);
}

test('canonical module flags require a verified self resolver', () => {
    assert.equal(resolve({ verified: false, permissions: { can_access_av: true } }), null);
    assert.equal(resolve({ verified: false, denied: true, permissions: { can_access_av: true } }), false);
    assert.equal(resolve({ verified: true, permissions: { can_access_av: false } }), false);
    assert.equal(resolve({ verified: true, permissions: { can_access_av: true } }), true);
    assert.equal(resolve({ verified: true, permissions: { can_access_av: true } }, 'toby_brown'), null);
});

test('canonical Que feature does not bypass row-work capabilities', () => {
    const start = source.indexOf('        function canAccessView(');
    const end = source.indexOf('        function isSalesShellAccess(', start);
    const fn = source.slice(start, end);
    assert.match(fn, /canonicalAllowed === true && targetView !== 'request'/);
    assert.match(fn, /capabilities && capabilities\.canViewQueue/);
    assert.match(fn, /isEvalSensitiveDataRestricted/);
    assert.match(fn, /isManagerViewDeniedUser/);
});

test('new Manager editor preserves navigation and legacy audit controls', () => {
    assert.match(source, /id="canonical-user-access-editor"/);
    assert.match(source, /id="effective-user-access-editor"/);
    assert.match(source, /Existing access audit and limited administration/);
    assert.match(source, /nativeAuthSessionUserId === nativeAuthProfile\?\.id/);
});

test('verified Eval Reports #2 overrides stay authoritative in bounded app-api handlers', () => {
    const api = fs.readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
    assert.match(api, /if \(surface === "eval2"\) return \{ flag: "can_access_eval_reports_2" \}/);
    assert.match(api, /const canViewEval2 = access\.permissions\.can_access_eval_reports_2 === true/);
    assert.match(api, /surface === "eval2" && \(canonicalAccess \|\| await resolveCanonicalUserAccess\(supabase, String\(profile\.id \|\| ""\)\)\)\.permissions\.can_access_eval_reports_2 !== true/);
    assert.match(api, /resolvedAccess\.permissions\.can_access_eval_reports_2 !== true/);
    assert.doesNotMatch(api, /canViewEval2 = \["dylan_collyge", "megan_kelly", "jd_jones"\]/);
});

test('canonical module grants extend only mapped read datasets and preserve actor scopes', () => {
    const api = fs.readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
    assert.match(api, /const CANONICAL_DATASET_READ_FLAGS: Record<string, readonly CanonicalUserAccessFlag\[]>/);
    assert.match(api, /request_queue: \["can_access_que"\]/);
    assert.match(api, /cav: \["can_access_av"\]/);
    assert.match(api, /reserves: \["can_access_av", "can_access_drive_mode"\]/);
    assert.match(api, /const canonicalDatasetAccess = dataset !== "suspend_tag" && canonicalDatasetReadAllowed\(canonicalAccess, dataset\)/);
    assert.match(api, /!hasTableReadAccess\(role, source\.permission, username\) && !canonicalDatasetAccess/);
    assert.match(api, /dataset === "suspend_tag"\s*\? !SUSPEND_TAG_EDITORS\.has\(username\)/);
    assert.match(api, /if \(dataset === "reserves" && access\.isRep && !access\.isAdmin && !FULL_ACCESS_USER_KEYS\.has\(username\)\)/);
    assert.match(api, /const repScope = \[\.\.\.patterns\]\.map\(\(pattern\) => `salesrepname\.ilike\./);
});

test('canonical inventory reads are operation-scoped and AV reads remain AV-only', () => {
    const api = fs.readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
    assert.match(api, /if \(dataset === "avOpen"\) return access\.permissions\.can_access_av === true/);
    assert.match(api, /if \(dataset === "lookup"\)[\s\S]*?"can_submit_reclass"/);
    assert.match(api, /if \(!hasTableReadAccess\(role, "ph_master_inventory", username\) && !canonicalInventoryAccess\)/);
    assert.match(api, /canonicalAccessForRequest\?\.permissions\.can_access_av === true[\s\S]*?new Set\(\["ph_cav_import", "ph_reserves", "ph_av_notes", "ph_view_av_hot_price_keys", "ph_app_settings"\]\)/);
    assert.match(api, /canRead: table => hasTableReadAccess\(role, table, username\)/);
});

test('module revocation cannot fall through a different module grant and legacy dataset role', () => {
    const api = fs.readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
    const gate = api.slice(api.indexOf('function canonicalActionGate('),api.indexOf('if (import.meta.main)'));
    assert.match(gate, /const flags = CANONICAL_DATASET_READ_FLAGS\[dataset\];/);
    assert.match(gate, /if \(flags\) return \{ any: flags \}/);
    assert.match(gate, /String\(params.dataset \|\| ""\).trim\(\) === "avOpen"\) return \{ flag: "can_access_av" \}/);
});
import { transpileModule } from 'typescript';
import { CANONICAL_USER_ACCESS_FLAGS, resolveCanonicalUserAccess, requireCanonicalUserAccessFlag, hasAnyCanonicalUserAccessFlag } from '../supabase/functions/_shared/canonical-user-access.ts';

const allFlags = value => Object.fromEntries(CANONICAL_USER_ACCESS_FLAGS.map(flag => [flag,value]));

test('server canonical resolver uses the bound actor and rejects malformed permission snapshots', async () => {
    let captured;
    const valid={revision:24,effective_permissions:allFlags(false)};
    const db={rpc:async(name,args)=>{captured={name,args};return {data:valid,error:null};}};
    const access=await resolveCanonicalUserAccess(db,'authenticated-profile-id');
    assert.equal(captured.name,'user_access_command_v1');
    assert.equal(captured.args.p_actor_profile_id,'authenticated-profile-id');
    assert.equal(captured.args.p_operation,'resolve');
    assert.equal(access.revision,24);
    assert.throws(()=>requireCanonicalUserAccessFlag(access,'can_access_que'),/USER_ACCESS_FORBIDDEN/);
    valid.effective_permissions.can_access_av='true';
    await assert.rejects(()=>resolveCanonicalUserAccess(db,'authenticated-profile-id'),/PERMISSION_SNAPSHOT_INVALID/);
    await assert.rejects(()=>resolveCanonicalUserAccess(db,''),/PROFILE_REQUIRED/);
});

test('server dataset gates cannot reuse an unrelated module grant after Que or AV revocation', () => {
    const api=fs.readFileSync(new URL('../supabase/functions/app-api/index.ts',import.meta.url),'utf8');
    const mapped=api.slice(api.indexOf('const CANONICAL_DATASET_READ_FLAGS:'),api.indexOf('// This read boundary deliberately'));
    const gates=api.slice(api.indexOf('function canonicalActionGate('),api.indexOf('if (import.meta.main)'));
    const js=transpileModule(mapped+'\n'+gates,{compilerOptions:{target:9}}).outputText;
    const ctx=vm.createContext({hasAnyCanonicalUserAccessFlag,String,Boolean});vm.runInContext(js,ctx);
    const access={revision:1,permissions:{...allFlags(false),can_access_drive_mode:true}};
    const allowed=(action,payload)=>{const gate=ctx.canonicalActionGate(action,payload);return gate?.flag?access.permissions[gate.flag]===true:gate?.any?hasAnyCanonicalUserAccessFlag(access,gate.any):false;};
    for(const dataset of ['request_queue','active_request','dock_item','suspend_tag'])assert.equal(allowed('dataset_read',{dataset}),false,dataset);
    assert.equal(allowed('inventory_read',{params:{dataset:'avOpen'}}),false);
    assert.equal(allowed('dataset_read',{dataset:'inventory_edits'}),true);
    access.permissions.can_access_que=true;
    assert.equal(allowed('dataset_read',{dataset:'request_queue'}),true);
    assert.equal(allowed('inventory_reclass_move',{}),false);
    access.permissions.can_submit_reclass=true;
    assert.equal(allowed('inventory_reclass_move',{}),true);
    assert.equal(allowed('suspend_tag',{operation:'complete'}),false);
});
