import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {actor,docker,sql,asActor,bootstrap,installPreviousFunctions} from './helpers/photo-auth-sql-fixture.mjs';
import {photoAuthorizationMigrationName,accessDefaultsWatchdogMigrationName,photoAuthorizationMigrationContract} from '../src/services/photo-authorization-migration-registry.mjs';

const container=process.env.GNC_PHOTO_AUTH_SQL_CONTAINER;
const snapshot=JSON.parse(fs.readFileSync('tests/fixtures/access-watchdog-installed.json','utf8'));
const migration=fs.readFileSync('supabase/migrations/'+accessDefaultsWatchdogMigrationName,'utf8');
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
function installBaseline(database) {
    for (const name of ['private.access_username_v23119','private.canonical_user_access_role_v1']) {
        sql(container,database,snapshot.functions.find(fn=>fn.name===name).definition+';');
    }
    sql(container,database,fs.readFileSync('tests/access-watchdog-bootstrap.sql','utf8'));
    for (const name of ['private.access_rep_roster_v23119','private.seed_user_access_v23119']) {
        sql(container,database,snapshot.functions.find(fn=>fn.name===name).definition+';');
    }
    sql(container,database,snapshot.resolver+';');
    sql(container,database,'INSERT INTO public.role_access_baselines VALUES '+snapshot.baselines
        .map(row=>'('+literal(row.role)+','+literal(JSON.stringify({...row.matrix_permissions,view_permissions:snapshot.view_permissions}))+'::jsonb)').join(',')+';');
}
function denied(database,id) {
    asActor(container,database,id,"DO $t$ BEGIN BEGIN PERFORM public.read_reviewed_watchdog_events_v3074(); "+
        "RAISE EXCEPTION 'WATCHDOG_FOREIGN_REVIEWER_ACCEPTED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $t$;");
}
function verifyWatchdog(database,resolverDigest) {
    assert.equal(sql(container,database,"SELECT md5(pg_get_functiondef('public.resolve_runtime_watchdog_events_v23158(bigint[])'::regprocedure));"),resolverDigest);
    for(const id of [1,12,13]) assert.equal(asActor(container,database,id,
        "SELECT jsonb_array_length(public.read_reviewed_watchdog_events_v3074()->'data');"),'2');
    const first=JSON.parse(asActor(container,database,1,"SELECT public.read_reviewed_watchdog_events_v3074(true,0);"));
    const second=JSON.parse(asActor(container,database,1,"SELECT public.read_reviewed_watchdog_events_v3074(true,250);"));
    assert.equal(first.data.length,250);assert.equal(first.hasMore,true);
    assert.equal(second.data.length,79);assert.equal(second.hasMore,false);
    assert.equal(new Set([...first.data,...second.data].map(row=>row.id)).size,329);
    denied(database,2);denied(database,4);
    sql(container,database,"UPDATE public.user_access SET manage_user_access='N' WHERE username='jd_jones';");
    denied(database,13);
    sql(container,database,"UPDATE public.profiles SET disabled_at=now() WHERE username='megan_kelly';");
    denied(database,12);
    asActor(container,database,1,"DO $t$ BEGIN BEGIN PERFORM public.read_reviewed_watchdog_events_v3074(false,-1); "+
        "RAISE EXCEPTION 'WATCHDOG_UNBOUNDED_OFFSET_ACCEPTED'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END; END $t$;");
    assert.equal(sql(container,database,"SELECT count(*) FROM public.app_runtime_watchdog_events WHERE status='open';"),'2');
    assert.equal(sql(container,database,"SELECT has_function_privilege('anon','public.read_reviewed_watchdog_events_v3074(boolean,integer)','EXECUTE');"),'f');
    assert.equal(sql(container,database,"SELECT has_table_privilege('authenticated','private.runtime_watchdog_reviewers_v3074','SELECT');"),'f');
}
function verifySeeding(database) {
    sql(container,database,"INSERT INTO public.profiles(id,username,role,must_change_password) VALUES "+
        "('"+actor(20)+"','mitch_kaiser','REP',false),('"+actor(21)+"','new_rep','REP',false),"+
        "('"+actor(22)+"','new_evaluator','EVAL',false),('"+actor(23)+"','new_qc','QC',false); "+
        "DO $t$ DECLARE p public.profiles; BEGIN FOR p IN SELECT * FROM public.profiles WHERE id IN "+
        "('"+actor(1)+"','"+actor(20)+"','"+actor(21)+"','"+actor(22)+"','"+actor(23)+"') LOOP "+
        "PERFORM private.seed_user_access_v23119(p); END LOOP; END $t$;");
    assert.equal(sql(container,database,"SELECT edit_any_row FROM public.user_access WHERE username='dylan_collyge';"),'N');
    assert.equal(sql(container,database,"SELECT string_agg(edit_any_row,',' ORDER BY username) FROM public.user_access WHERE username IN ('mitch_kaiser','new_rep');"),'N,N');
    assert.equal(sql(container,database,"SELECT edit_any_row||':'||edit_assigned_rows_only FROM public.user_access WHERE username='new_evaluator';"),'N:Y');
    assert.equal(sql(container,database,"SELECT edit_any_row FROM public.user_access WHERE username='new_qc';"),'Y');
}
test('table role defaults preserve overrides and native Watchdog reads cannot mutate incidents',{skip:!container},()=>{
    const database='access_watchdog_'+process.pid;
    docker(container,['createdb','-U','postgres',database]);
    try {
        sql(container,database,bootstrap());installPreviousFunctions(container,database);
        sql(container,database,fs.readFileSync('supabase/migrations/'+photoAuthorizationMigrationName,'utf8'));
        installBaseline(database);
        const digest=sql(container,database,"SELECT md5(pg_get_functiondef('public.resolve_runtime_watchdog_events_v23158(bigint[])'::regprocedure));");
        sql(container,database,migration);sql(container,database,migration);
        assert.equal(sql(container,database,photoAuthorizationMigrationContract(accessDefaultsWatchdogMigrationName)),'t');
        verifySeeding(database);verifyWatchdog(database,digest);
    } finally {docker(container,['dropdb','-U','postgres',database]);}
});
