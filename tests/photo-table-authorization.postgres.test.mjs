import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {installed,actor,docker,sql,asActor,bootstrap,installPreviousFunctions,assertDriveDenied} from './helpers/photo-auth-sql-fixture.mjs';
import {photoAuthorizationMigrationName,photoAuthorizationMigrationContract} from '../src/services/photo-authorization-migration-registry.mjs';

const container=process.env.GNC_PHOTO_AUTH_SQL_CONTAINER;
const migration=fs.readFileSync('supabase/migrations/'+photoAuthorizationMigrationName,'utf8');
const path=uid=>'drive-evidence/'+Buffer.from(uid).toString('hex')+'/v2/'+'a'.repeat(64)+'.jpg';
function assertStorageDenied(database,id,bucket,name) {
    asActor(container,database,id,"SET ROLE authenticated; DO $t$ BEGIN BEGIN "+
        "INSERT INTO storage.objects(bucket_id,name) VALUES('"+bucket+"','"+name+"'); "+
        "RAISE EXCEPTION 'UNAUTHORIZED_STORAGE_ACCEPTED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $t$;");
}
function verifyActorScopes(database) {
    for (const id of [1,2,5,6,8,9,10]) assertDriveDenied(container,database,id);
    for (const [id,uid,loc] of [[2,'master-a','A.01'],[3,'master-b','B.01'],[4,'master-c','C.01'],[11,'master-c','C.01']]) {
        assert.equal(asActor(container,database,id,"SELECT (private.require_drive_live_change_profile_v2392('"+
            uid+"','ITEM','"+loc+"','26.F1')).id='"+actor(id)+"'::uuid;"),'t');
    }
    assertDriveDenied(container,database,4,'master-a','A.01','27.F1');
    assert.equal(asActor(container,database,3,"SELECT private.can_work_request_identity('other','fixture_rep','other');"),'t');
    assert.equal(asActor(container,database,3,"SELECT private.can_work_request_identity('other','other','other');"),'f');
    assert.equal(asActor(container,database,7,"SELECT private.can_save_request_work();"),'f');
    assert.equal(asActor(container,database,11,"SELECT private.can_save_request_work();"),'t');
    assert.equal(asActor(container,database,2,"SELECT private.can_work_request_row_v3074(to_jsonb(row)) FROM public.ph_requests_pending row WHERE unique_id='completed-own';"),'t');
    assert.equal(asActor(container,database,2,"SELECT private.can_work_request_row_v3074(to_jsonb(row)) FROM public.ph_requests_pending row WHERE unique_id='foreign';"),'f');
}
function verifyStorage(database) {
    assertStorageDenied(database,1,'location_sales_notes_photos',path('master-b'));
    assertStorageDenied(database,2,'location_sales_notes_photos',path('master-b'));
    for (const [id,bucket,name] of [[2,'location_sales_notes_photos',path('master-a')],
        [3,'location_sales_notes_photos',path('master-b')],[3,'request_photos','v2/photo.jpg'],
        [3,'request_photos','_thumbs/v2/photo-w144.jpg'],[3,'request_photos','2026-11-11/ITEM-B01-123.jpg']]) {
        asActor(container,database,id,"SET ROLE authenticated; INSERT INTO storage.objects(bucket_id,name) VALUES('"+bucket+"','"+name+"'); "+
            "UPDATE storage.objects SET name=name WHERE bucket_id='"+bucket+"' AND name='"+name+"';");
    }
    sql(container,database,"SET ROLE anon; DO $t$ BEGIN BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('request_photos','v2/anonymous.jpg'); "+
        "RAISE EXCEPTION 'ANONYMOUS_PHOTO_ACCEPTED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $t$;");
    sql(container,database,"SET ROLE anon; INSERT INTO storage.objects(bucket_id,name) VALUES('unrelated_bucket','private/path');");
    sql(container,database,"SET ROLE service_role; INSERT INTO storage.objects(bucket_id,name) VALUES('request_photos','worker/private/path');");
    assert.equal(sql(container,database,"SET ROLE anon; SELECT count(*)>0 FROM storage.objects;"),'t');
    assertStorageDenied(database,7,'request_photos','v2/module-denied.jpg');
    asActor(container,database,2,"SET ROLE authenticated; DO $t$ BEGIN BEGIN "+
        "UPDATE storage.objects SET name='"+path('master-b')+"' WHERE bucket_id='location_sales_notes_photos' AND name='"+path('master-a')+"'; "+
        "RAISE EXCEPTION 'FOREIGN_UPSERT_PATH_ACCEPTED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $t$;");
}
function verifyExistingCallers(database) {
    const native="SELECT public.save_request_work('completed-own',1,'{}',true)->>'delivery_state';";
    assert.equal(asActor(container,database,2,native),'already_completed');
    asActor(container,database,1,"DO $t$ BEGIN BEGIN PERFORM public.save_request_work('completed-own',1,'{}',true); "+
        "RAISE EXCEPTION 'FOREIGN_NATIVE_REQUEST_ACCEPTED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $t$;");
    const service="SET request.jwt.claim.role='service_role'; SELECT public.request_work_command_v1('"+actor(2)+
        "','11111111-1111-1111-1111-111111111111','save','history-own',1,'{}',true)->>'delivery_state';";
    assert.equal(sql(container,database,service),'already_completed');
    assert.equal(sql(container,database,"SET request.jwt.claim.role='service_role'; SELECT public.request_completion_receipt_v2372('"+
        actor(2)+"','11111111-1111-1111-1111-111111111111','history-own')->>'acknowledged';"),'true');
    assert.equal(asActor(container,database,2,"SELECT public.get_request_capabilities()->>'can_take_photo';"),'true');
    assert.equal(asActor(container,database,7,"SELECT public.get_request_capabilities()->>'can_take_photo';"),'false');
}
test('PostgreSQL photo and Request writes use active table permissions and exact-row authority',{skip:!container},()=>{
    const database='photo_authorization_'+process.pid;
    docker(container,['createdb','-U','postgres',database]);
    try {
        sql(container,database,bootstrap());
        installPreviousFunctions(container,database);
        assert.equal(asActor(container,database,1,"SELECT (private.require_drive_live_change_profile_v2392('master-b','ITEM','B.01','26.F1')).id IS NOT NULL;"),'t');
        sql(container,database,migration);
        sql(container,database,migration);
        assert.equal(sql(container,database,photoAuthorizationMigrationContract(photoAuthorizationMigrationName)),'t');
        verifyActorScopes(database);
        verifyStorage(database);
        verifyExistingCallers(database);
        sql(container,database,"UPDATE public.ph_app_users SET must_change_password=true WHERE id=4;");
        assert.equal(asActor(container,database,4,"SELECT (private.require_drive_live_change_profile_v2392('master-c','ITEM','C.01','26.F1')).id IS NOT NULL;"),'t',
            'a verified native credential does not inherit a legacy-only password setup flag');
        assert.equal(sql(container,database,"SELECT value->>'app_version'||':'||(value->>'retained') FROM public.ph_app_settings;"),'3.0.74:yes');
        const previous=installed.functions.find(fn=>fn.proname==='save_request_work_pre_state_machine_v2359').definition;
        sql(container,database,previous.replace('existing.requested_by','existing.request_folder')+';');
        const result=spawnSync('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],
            {input:migration,encoding:'utf8',windowsHide:true,timeout:20000});
        assert.notEqual(result.status,0);
        assert.match(result.stderr,/REQUEST_AUTH_ANCHOR_CHANGED/);
    } finally { docker(container,['dropdb','-U','postgres',database]); }
});
