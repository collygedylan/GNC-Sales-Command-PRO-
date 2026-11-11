import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {suspendAssignedMigrationName,suspendAssignedMigrationContracts} from '../src/core/suspend-assigned-migration-contract.mjs';

const container=process.env.GNC_SUSPEND_SQL_CONTAINER;
function docker(args,input) {
    const result=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout:15000});
    assert.equal(result.status,0,(result.stderr||result.error?.message||'').slice(-1800));
    return result.stdout.trim();
}
function sql(database,source) {
    return docker(['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],source);
}
const actor=id=>'00000000-0000-0000-0000-'+String(id).padStart(12,'0');
const command=(id,uid)=>`select suspend_tag_private.command('${actor(id)}','save','{"sourceUid":"${uid}","spec":"saved-${id}"}',null,0);`;
function assertDenied(database,id,uid) {
    sql(database,`do $test$ begin
      begin perform suspend_tag_private.command('${actor(id)}','save','{"sourceUid":"${uid}","spec":"foreign"}',null,0);
        raise exception 'FOREIGN_WRITE_ACCEPTED';
      exception when insufficient_privilege then null; end;
    end $test$;`);
}
function assertScope(database,id,expected) {
    const result=sql(database,`set role authenticated; set fixture.actor='${actor(id)}'; select count(*) from public.ph_active_suspend;`);
    assert.equal(Number(result),expected);
}
function verifyOwnerAuthorization(database) {
    for(const [id,count] of [[1,44],[2,45],[3,1],[4,90],[5,90],[6,0]]) assertScope(database,id,count);
    for(const [id,uid] of [[1,'tag-2'],[2,'tag-90'],[3,'tag-1'],[4,'tag-90'],[5,'tag-1']]) sql(database,command(id,uid));
    for(const [id,uid] of [[1,'tag-1'],[1,'tag-90'],[2,'tag-2'],[3,'tag-2'],[6,'tag-2']]) assertDenied(database,id,uid);
    assert.equal(sql(database,`select count(*) from public.fixture_receipts`),'5');
    assert.equal(sql(database,`select count(*) from public.fixture_receipts where spec='foreign'`),'0');
    assert.equal(sql(database,`select spec is null from public.ph_soc_master where unique_id='tag-3'`),'t');
    const rows=sql(database,`select jsonb_array_length(suspend_tag_private.command('${actor(1)}','rows','{"ids":["tag-1","tag-2","tag-90"]}',null,0)->'rows');`);
    assert.equal(rows,'1');
    assert.equal(sql(database,`set role authenticated; set fixture.actor='${actor(6)}'; select private.queue_scope_actor_v23159('request');`),'*');
    assert.equal(sql(database,`select suspend_tag_private.assigned_owner_v3068('111111.030.','D.10.021','27.F1')`),'zoe_green');
    assert.equal(sql(database,`select suspend_tag_private.assigned_owner_v3068('111111.030.','D.10.022','27.F1')`),'worker_a');
    sql(database,`select suspend_tag_private.group_command('${actor(2)}','close','{"sourceUid":"tag-90","inventoryIds":["master-b"]}',null,0)`);
    sql(database,`do $test$ begin begin perform suspend_tag_private.group_command('${actor(1)}','replace_location','{"sourceUid":"tag-2","inventoryIds":["master-b"]}',null,0); raise exception 'FOREIGN_TARGET_ACCEPTED'; exception when insufficient_privilege then null; end; end $test$;`);
}

test('PostgreSQL SUSPEND guards deny foreign writes and preserve safe owner/admin saves', {skip:!container},async()=>{
    const database='suspend_scope_'+process.pid;
    docker(['exec',container,'createdb','-U','postgres',database]);
    try {
        sql(database,fs.readFileSync('tests/suspend-assigned-routing.sql','utf8'));
        const originalCommand=sql(database,"select pg_get_functiondef('suspend_tag_private.command(uuid,text,jsonb,uuid,bigint)'::regprocedure)");
        sql(database,command(1,'tag-90'));
        assert.equal(sql(database,'select count(*) from public.fixture_receipts'),'1','old guard accepts a foreign evaluator row');
        sql(database,'truncate public.fixture_receipts; update public.ph_soc_master set spec=null;');
        const migration=fs.readFileSync('supabase/migrations/'+suspendAssignedMigrationName,'utf8');
        sql(database,migration);sql(database,migration);
        sql(database,'revoke usage on schema suspend_tag_private from authenticated;');
        assert.equal(sql(database,suspendAssignedMigrationContracts[suspendAssignedMigrationName]),'t');
        verifyOwnerAuthorization(database);
        sql(database,`delete from public.ph_soc_master where unique_id='tag-1';`);
        assertScope(database,3,0);assertScope(database,4,89);
        sql(database,originalCommand.replace('if not found or','if s.unique_id is null or'));
        const rejected=spawnSync('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],
            {input:migration,encoding:'utf8',windowsHide:true,timeout:15000});
        assert.notEqual(rejected.status,0);
        assert.match(rejected.stderr,/SUSPEND_ASSIGNED_COMMAND_ANCHOR_CHANGED/);
        assert.equal(sql(database,"select position('require_row_owner_v3068' in pg_get_functiondef('suspend_tag_private.command(uuid,text,jsonb,uuid,bigint)'::regprocedure))"),'0');
    } finally {docker(['exec',container,'dropdb','-U','postgres',database]);}
});
