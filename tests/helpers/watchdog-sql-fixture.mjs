import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {watchdogRpcRecoveryMigration,watchdogRequestReceiptIndexMigration} from '../../src/services/watchdog-rpc-migration-contract.mjs';

const read = file => fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8');
const docker = args => execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:20000,stdio:['pipe','pipe','pipe']});

function sql(container,database,source) {
    return execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d',database,'-Atq','-v','ON_ERROR_STOP=1'],
        {input:source,encoding:'utf8',windowsHide:true,timeout:20000,stdio:['pipe','pipe','pipe']});
}

async function proveLockBehavior(container,database,shouldWait) {
    const holder=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d',database,'-Atq','-v','ON_ERROR_STOP=1'],
        {windowsHide:true,stdio:['pipe','pipe','pipe']});
    const complete=new Promise((resolve,reject)=>{holder.on('error',reject);holder.on('exit',code=>code===0?resolve():reject(Error('LOCAL_LOCK_HOLDER_FAILED')));});
    const ready=new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('LOCAL_LOCK_HOLDER_TIMEOUT')),5000);
        holder.stdout.on('data',chunk=>{if(chunk.toString().includes('HELD')){clearTimeout(timer);resolve();}});
    });
    holder.stdin.end("begin;select pg_advisory_xact_lock(hashtextextended('drive-row:exact-row',0));select 'HELD';select pg_sleep(1);commit;");
    await ready;
    const command="select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);select public.unlock_drive_evidence_v1('exact-row','');";
    const began=performance.now();
    if (shouldWait) {
        assert.ok(sql(container,database,command).includes('canonicalConfirmed'));
        assert.ok(performance.now()-began>=150,'A contended unlock waits rather than inventing success');
    } else assert.throws(()=>sql(container,database,command),/DRIVE_SAVE_BUSY/);
    await complete;
    return Math.round(performance.now()-began);
}

export async function runWatchdogSqlFixture(container) {
    assert.match(container,/^[a-zA-Z0-9_-]+$/);
    const image=docker(['inspect','--format','{{.Config.Image}}',container]).trim();
    assert.match(image,/supabase\/postgres:17\./);
    const database='watchdog72_'+Date.now();
    docker(['exec',container,'createdb','-U','postgres',database]);
    try {
        sql(container,database,read('tests/sql/watchdog-rpc-recovery-fixture.sql'));
        const baseline=JSON.parse(fs.readFileSync('G:/My Drive/GNC/AgData/Release Evidence/v3.0.72-sql-baseline.json','utf8'));
        sql(container,database,baseline.unlockSql);
        await proveLockBehavior(container,database,false);
        const migration=read('supabase/migrations/'+watchdogRpcRecoveryMigration);
        sql(container,database,migration);
        sql(container,database,migration);
        const indexMigration=read('supabase/migrations/'+watchdogRequestReceiptIndexMigration);
        sql(container,database,indexMigration);
        sql(container,database,indexMigration);
        sql(container,database,read('tests/sql/watchdog-rpc-recovery-assertions.sql'));
        const lockWaitMs=await proveLockBehavior(container,database,true);
        return {passed:true,postgres:image,baselineBusyReproduced:true,lockWaitMs,
            checks:['admin','assigned','foreign-denied','anonymous-denied','exact-row','evidence-retained','stale-signature','8s-bound','index','idempotent-migration']};
    } finally {
        docker(['exec',container,'dropdb','-U','postgres',database]);
    }
}
