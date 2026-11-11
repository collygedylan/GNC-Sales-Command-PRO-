import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {actor,docker,sql,bootstrap,installPreviousFunctions} from './helpers/photo-auth-sql-fixture.mjs';
import {photoAuthorizationMigrationName,photoUploadServiceMigrationName,photoAuthorizationMigrationContract} from '../src/services/photo-authorization-migration-registry.mjs';

const container=process.env.GNC_PHOTO_AUTH_SQL_CONTAINER;
const migration=fs.readFileSync('supabase/migrations/'+photoUploadServiceMigrationName,'utf8');
const snapshot=JSON.parse(fs.readFileSync('tests/fixtures/photo-upload-proof-installed.json','utf8'));
const access=JSON.parse(fs.readFileSync('tests/fixtures/access-watchdog-installed.json','utf8'));
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const identity=(masterUid='master-b',locationCode='B.01',extra={})=>({masterUid,itemCode:'ITEM',locationCode,lotCode:'26.F1',...extra});
function command(id,prefix,proof,session=null,issued='extract(epoch from now())::bigint',username=null) {
    const names={1:'dylan_collyge',2:'fixture_worker',3:'fixture_rep',4:'fixture_admin',7:'fixture_module_off',12:'zoe_green'};
    return "public.authorize_photo_upload_v3074('"+actor(id)+"',"+literal(username||names[id])+","+literal(prefix)+","+
        literal(JSON.stringify(proof))+"::jsonb,"+(session?literal(session)+"::uuid":'null')+","+issued+")";
}
function service(database,expression) {
    return sql(container,database,"SET request.jwt.claim.role='service_role'; SELECT "+expression+";");
}
function denied(database,expression,code='insufficient_privilege') {
    sql(container,database,"SET request.jwt.claim.role='service_role'; DO $t$ BEGIN BEGIN PERFORM "+expression+
        "; RAISE EXCEPTION 'UNAUTHORIZED_PHOTO_PROOF_ACCEPTED'; EXCEPTION WHEN "+code+" THEN NULL; END; END $t$;");
}
function verifyExactSources(database) {
    const native="11111111-1111-1111-1111-111111111111",rep="33333333-3333-3333-3333-333333333333";
    assert.equal(JSON.parse(service(database,command(2,'lsn-',identity('master-a','A.01'),native))).masterUid,'master-a');
    assert.equal(JSON.parse(service(database,command(3,'req-',identity('master-b','B.01',{requestId:'pending-rep'}),rep))).requestId,'pending-rep');
    assert.equal(JSON.parse(service(database,command(3,'req-',identity()))).requestId,'pending-rep','legacy clients require a unique exact source');
    denied(database,command(1,'lsn-',identity()));denied(database,command(2,'lsn-',identity(),native));
    denied(database,command(3,'req-',identity(),native));
    denied(database,command(4,'req-',identity('master-b','B.01',{requestId:'foreign'})));
    denied(database,command(7,'req-',identity('master-b','B.01',{requestId:'pending-rep'})));
    denied(database,command(2,'req-',identity('master-a','A.01',{requestId:'completed-own'}),native));
    denied(database,command(4,'lsn-',{...identity(),lotCode:'27.F1'}));
    denied(database,command(3,'req-',identity(),null,'extract(epoch from now())::bigint','foreign_actor'));
    denied(database,command(3,'req-',identity(),null,'0'));
    assert.equal(JSON.parse(service(database,command(2,'req-',identity('master-a','A.01',{suspendTagId:'tag-a'}),native))).suspendTagId,'tag-a');
    assert.equal(JSON.parse(service(database,command(12,'req-',identity('master-z','Z.01',{suspendTagId:'tag-z'})))).suspendTagId,'tag-z');
    denied(database,command(4,'req-',identity('master-b','B.01',{suspendTagId:'tag-a'})));
    sql(container,database,"INSERT INTO public.ph_requests_pending(unique_id,master_id,itemcode,locationcode,lotcode,req_status,req_archived,request_selected_rep_username) "+
        "VALUES('sibling','master-b','ITEM','B.01','26.F1','pending',false,'fixture_rep');");
    denied(database,command(3,'req-',identity()),'invalid_parameter_value');
    assert.equal(JSON.parse(service(database,command(3,'req-',identity('master-b','B.01',{requestId:'pending-rep'}),rep))).requestId,'pending-rep');
}
test('service photo authority requires verified session plus exact table-authorized source',{skip:!container},()=>{
    const database='photo_service_'+process.pid;
    docker(container,['createdb','-U','postgres',database]);
    try {
        sql(container,database,bootstrap());installPreviousFunctions(container,database);
        sql(container,database,fs.readFileSync('supabase/migrations/'+photoAuthorizationMigrationName,'utf8'));
        sql(container,database,access.functions.find(fn=>fn.name==='private.access_username_v23119').definition+';');
        sql(container,database,fs.readFileSync('tests/photo-upload-proof-bootstrap.sql','utf8'));
        sql(container,database,snapshot.functions.map(fn=>fn.definition+';').join('\n'));
        sql(container,database,migration);sql(container,database,migration);
        assert.equal(sql(container,database,photoAuthorizationMigrationContract(photoUploadServiceMigrationName)),'t');
        verifyExactSources(database);
        assert.equal(sql(container,database,"SELECT has_function_privilege('authenticated','public.authorize_photo_upload_v3074(uuid,text,text,jsonb,uuid,bigint)','EXECUTE');"),'f');
        assert.equal(sql(container,database,"SELECT has_function_privilege('service_role','public.authorize_photo_upload_v3074(uuid,text,text,jsonb,uuid,bigint)','EXECUTE');"),'t');
        assert.equal(sql(container,database,"SET request.jwt.claim.role='service_role'; SELECT "+command(3,'req-',identity('master-b','B.01',{requestId:'pending-rep'}))+
            "; SELECT auth.uid() IS NULL;").split('\n').at(-1),'t');
    } finally {docker(container,['dropdb','-U','postgres',database]);}
});
