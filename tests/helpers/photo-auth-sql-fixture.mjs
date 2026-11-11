import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

export const installed = JSON.parse(fs.readFileSync(new URL('../fixtures/photo-authorization-installed.json',import.meta.url),'utf8'));
export const actor = id => '00000000-0000-0000-0000-' + String(id).padStart(12,'0');
export function docker(container,args,input) {
    const result=spawnSync('docker',['exec','-i',container,...args],{input,encoding:'utf8',windowsHide:true,timeout:20000});
    assert.equal(result.status,0,(result.stderr||result.error?.message||'').slice(-2400));
    return result.stdout.trim();
}
export function sql(container,database,input) {
    return docker(container,['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],input);
}
export function asActor(container,database,id,input) {
    return sql(container,database,"SET request.jwt.claim.sub='"+actor(id)+"'; SET request.jwt.claim.role='authenticated'; "+input);
}
export function bootstrap() {
    return fs.readFileSync(new URL('../photo-auth-bootstrap.sql',import.meta.url),'utf8');
}
export function installPreviousFunctions(container,database) {
    const ordered=['normalized_profile_role','normalize_inventory_live_change_username_v2392','current_active_profile',
        'current_profile','is_service_role_request','can_save_request_work','can_work_request_identity',
        'inventory_row_assigned_to_actor_v2392','inventory_unrestricted_actor_v23155',
        'require_drive_live_change_profile_v2392','can_upload_drive_evidence_v23115',
        'save_request_work_pre_state_machine_v2359','save_request_work','request_work_command_v1_pre_state_machine_v2359',
        'request_work_command_v1','request_completion_receipt_v2372'];
    sql(container,database,ordered.map(name=>installed.functions.find(fn=>fn.proname===name).definition+';').join('\n'));
}
export function assertDriveDenied(container,database,id,uid='master-b',location='B.01',lot='26.F1') {
    asActor(container,database,id,"DO $t$ BEGIN BEGIN PERFORM private.require_drive_live_change_profile_v2392('"+
        uid+"','ITEM','"+location+"','"+lot+"'); RAISE EXCEPTION 'FOREIGN_EVIDENCE_ACCEPTED'; "+
        "EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $t$;");
}
