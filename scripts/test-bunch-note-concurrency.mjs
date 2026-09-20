import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
const connectionString=process.env.BUNCH_NOTE_TEST_DB_URL||'';
const url=new URL(connectionString||'postgresql://invalid');
assert.equal(process.env.CI,'true');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Hosted fixtures forbidden');
const config={connectionString,statement_timeout:15000,connectionTimeoutMillis:10000};
const admin=new pg.Client(config), clients=[new pg.Client(config),new pg.Client(config)];
const creator=randomUUID(),workers=[randomUUID(),randomUUID()],batch=randomUUID(),job=randomUUID(),preview=randomUUID();
const ids=[creator,...workers]; const prefix='BN-CONC-'+randomUUID();
await admin.connect();
const auth=client=>client.query("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false),set_config('request.jwt.claim.role','service_role',false)");
try {
 await auth(admin);
 assert.equal((await admin.query("select count(*)::int n from public.profiles where username='dylan_collyge'")).rows[0].n,0);
 for(const [i,id] of ids.entries()) {
  await admin.query("insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values($1,$2,'{}','{}')",[id,id+'@example.invalid']);
  await admin.query('insert into public.profiles(id,username,display_name,role,must_change_password) values($1,$2,$2,$3,false)',[id,i===0?'dylan_collyge':(prefix+i).toLowerCase(),i===0?'ADMIN':'EVAL']);
 }
 await admin.query("insert into bunch_note_private.batches(id,created_by,block,body) values($1,$2,$3,'{}')",[batch,creator,prefix]);
 await admin.query("insert into bunch_note_private.jobs(id,batch_id,note_number,block,location,body,created_by) values($1,$2,$3,$3,$3,'{\"actions\":[{\"id\":\"a\",\"instructions\":\"Do work\"}]}',$4)",[job,batch,prefix,creator]);
 await Promise.all(clients.map(async c=>{await c.connect();await auth(c);await c.query('set role service_role');}));
 const cmd=(c,actor,op,payload,revision,id=randomUUID())=>c.query('select public.bunch_note_command_v1($1,$2,$3,$4,$5) result',[actor,op,payload,id,revision]);
 const claims=await Promise.allSettled(clients.map((c,i)=>cmd(c,workers[i],'claim',{job_id:job},1)));
 assert.equal(claims.filter(r=>r.status==='fulfilled').length,1,'exactly one simultaneous claimant');
 const winner=claims[0].status==='fulfilled'?0:1, loser=1-winner;
 await assert.rejects(cmd(clients[loser],workers[loser],'get',{job_id:job},null),/BUNCH_NOTE_NOT_FOUND/);
 const id=randomUUID(),payload={job_id:job,action_id:'a',status:'done'};
 const repeated=await Promise.all(clients.map(c=>cmd(c,workers[winner],'progress',payload,2,id)));
 assert.deepEqual(repeated[0].rows,repeated[1].rows,'duplicate concurrent progress replays one result');
 await cmd(clients[winner],workers[winner],'release',{job_id:job},3);
 const renewed=await Promise.allSettled(clients.map((c,i)=>cmd(c,workers[i],'claim',{job_id:job},4)));
 assert.equal(renewed.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await admin.query('select progress from bunch_note_private.jobs where id=$1',[job])).rows[0].progress.a.status,'done');
 console.log('Bunch Note simultaneous claims, stale reads, duplicate progress and release checks passed.');
} finally {
 for(const c of clients) await c.end().catch(()=>{});
 await admin.query('delete from bunch_note_private.commands where actor_id=any($1::uuid[])',[ids]);
 await admin.query('delete from bunch_note_private.audit where actor_id=any($1::uuid[])',[ids]);
 await admin.query('delete from bunch_note_private.jobs where id=$1',[job]);
 await admin.query('delete from bunch_note_private.batches where id=$1',[batch]);
 await admin.query('delete from public.profiles where id=any($1::uuid[])',[ids]);
 await admin.query('delete from auth.users where id=any($1::uuid[])',[ids]);
 await admin.end();
}
