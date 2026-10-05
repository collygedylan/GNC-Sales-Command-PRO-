import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrationContractQuery, suspendTagApprovalMigrationName } from '../../scripts/apply-item-low-stock-migration.mjs';

// Disposable PostgreSQL only. No hosted connection string or production access.
const host = process.env.PGHOST || '127.0.0.1';
if (!['localhost','127.0.0.1'].includes(host)) throw Error('ISOLATED_DATABASE_REQUIRED');
const connection = { host,port:Number(process.env.PGPORT || 55439),database:process.env.PGDATABASE || 'suspend_tag_test',user:'postgres',password:'disposable_ci_only' };
const db = new pg.Client(connection);
await db.connect();
try {
  const baseline=fs.readFileSync('supabase/migrations/20260929200000_production_baseline.sql','utf8');
  const table=name => { const match=baseline.match(new RegExp('CREATE TABLE public\\.'+name+' \\([\\s\\S]*?\\n\\);')); assert.ok(match,name); return match[0]; };
  await db.query(`do $$begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    end$$;
    create schema auth; create schema private;
    create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function private.is_service_role_request() returns boolean language sql stable as $$select coalesce(auth.jwt()->>'role','')='service_role'$$;
    create function private.scheduled_handover_cutoff_reached_v1(text,timestamptz) returns boolean language sql stable as $$select false$$;
    ${['profiles','ph_app_users','ph_soc_master','ph_master_inventory','ph_request_delivery_outbox'].map(table).join('\n')}
    alter table public.profiles add primary key(id); alter table public.ph_soc_master add primary key(unique_id);
    alter table public.ph_request_delivery_outbox add primary key(event_id); alter table public.ph_request_delivery_outbox add unique(event_key);
    alter table public.ph_soc_master enable row level security;
    grant usage on schema auth,private to authenticated,service_role;
  `);
  await db.query(fs.readFileSync('supabase/migrations/20261005194158_suspend_tag_approval_loop.sql','utf8'));
  assert.equal((await db.query(migrationContractQuery(suspendTagApprovalMigrationName))).rows[0].installed,true);
  await db.query('set role anon');
  await assert.rejects(db.query('select * from public.ph_soc_master'),/permission denied/);
  await assert.rejects(db.query('select public.suspend_tag_command_v1(null,\'rows\')'),/permission denied/);
  await db.query('reset role');
  const users={};
  for(const name of ['dylan_collyge','megan_kelly','dan_mccuistion','jd_jones','toby_brown','other_rep']) {
    users[name]={id:randomUUID(),session:randomUUID()};
    await db.query('insert into profiles(id,username,display_name,role) values($1,$2,$3,$4)',[users[name].id,name,name.split('_').map(x=>x[0].toUpperCase()+x.slice(1)).join(' '),name.includes('rep')||name==='toby_brown'?'REP':'Admin']);
    await db.query('insert into auth.users values($1,$2,now());',[users[name].id,`${name}@example.test`]);
    await db.query('insert into auth.sessions values($1,$2,null)',[users[name].session,users[name].id]);
  }
  const actor=async(name,service=false)=>{
    await db.query('reset role'); const u=users[name];
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({iss:'https://kzrnyjsosryejjejliii.supabase.co/auth/v1',sub:u.id,session_id:u.session,role:service?'service_role':'authenticated',exp:Math.floor(Date.now()/1000)+3600})]);
    await db.query(service?'set role service_role':'set role authenticated');
  };
  const command=async(name,operation,payload,version=null,id=randomUUID())=>{
    await actor(name,true);
    return (await db.query('select public.suspend_tag_command_v1($1,$2,$3,$4,$5,$6) as result',[users[name].id,operation,payload,id,version,users[name].session])).rows[0].result;
  };
  const admin=async(sql,args=[])=>{await db.query('reset role'); return db.query(sql,args);};
  const revision='2026-10-05T12:00:00+00:00';
  await admin(`insert into ph_soc_master(unique_id,last_updated,suspend,suspend_to,itemcode,locationcode,lotcode,salesrepname,customername,consigneename,commonname,contsize,quantityordered)
    values('row-1',$1,'SUSPEND','DC','ROYAL','E.23.000','LOT','Toby Brown','Outdoor Living Supply','Outdoor Living Supply','Royal Red butterfly bush','#1','10'),
      ('not-suspend',$1,'','DC','OTHER','B.1','','Toby Brown','','','Other','#1','0');`,[revision]);
  for(const name of ['dylan_collyge','megan_kelly','dan_mccuistion']) { await actor(name); assert.equal((await db.query('select count(*) from ph_soc_master')).rows[0].count,'1'); }
  await actor('jd_jones'); assert.equal((await db.query('select count(*) from ph_soc_master')).rows[0].count,'0');
  await assert.rejects(command('jd_jones','complete',{sourceUid:'row-1',expectedLastUpdated:revision}),/FORBIDDEN/);
  await actor('dylan_collyge');
  await assert.rejects(db.query("update ph_soc_master set quantityordered='999' where unique_id='row-1'"),/permission denied/);
  await assert.rejects(db.query("update ph_soc_master set date_completed=now() where unique_id='row-1'"),/permission denied/);
  await db.query("update ph_soc_master set dock_note='retained note' where unique_id='row-1'");
  await assert.rejects(command('dylan_collyge','save',{sourceUid:'row-1',expectedLastUpdated:revision,patch:{quantityordered:'999'}},1),/FIELD_FORBIDDEN/);
  await assert.rejects(command('dylan_collyge','save',{sourceUid:'row-1',expectedLastUpdated:revision,patch:{completed_by:'forged'}},1),/FIELD_FORBIDDEN/);
  await assert.rejects(command('dylan_collyge','complete',{sourceUid:'row-1',expectedLastUpdated:revision}),/PHOTO_REQUIRED/);
  const patch={dock_photo_link:'https://example.test/photo.jpg',dock_photo_name:'saved-photo.jpg',match:'100',av_note:'Good stock',dock_spec:'Royal red',dock_note:'retained note'};
  const input={sourceUid:'row-1',expectedLastUpdated:revision,patch}; const token=randomUUID();
  const completed=await command('dylan_collyge','complete',input,1,token);
  assert.equal(completed.row.suspend_tag_status,'completed'); assert.equal(completed.row.suspend_tag_completed_by,'dylan_collyge');
  assert.deepEqual(await command('dylan_collyge','complete',input,1,token),completed);
  assert.equal((await admin('select count(*) from ph_request_delivery_outbox')).rows[0].count,'0','initial completion is manual');
  const sent=await command('megan_kelly','send',{sourceUid:'row-1',expectedLastUpdated:revision},completed.row.suspend_tag_version);
  const id=sent.row.suspend_tag_approval_id; assert.ok(id); assert.equal(sent.row.suspend_tag_status,'awaiting_rep');
  const snapshot=(await admin('select * from suspend_tag_private.approvals where id=$1',[id])).rows[0];
  assert.equal(snapshot.submitter_email,'dylan_collyge@example.test'); assert.equal(snapshot.rep_email,'toby_brown@example.test');
  await assert.rejects(command('dan_mccuistion','save',{...input,patch:{dock_note:'changed'}},sent.row.suspend_tag_version),/REVIEW_LOCKED/);
  await assert.rejects(command('other_rep','decide',{approvalId:id,decision:'approve'}),/FORBIDDEN/);
  assert.equal((await command('toby_brown','approval',{approvalId:id})).canDecide,true);
  const denied=await command('toby_brown','decide',{approvalId:id,decision:'deny'}); assert.equal(denied.decision,'denied');
  assert.equal((await command('toby_brown','decide',{approvalId:id,decision:'deny'})).decision,'denied');
  await assert.rejects(command('toby_brown','decide',{approvalId:id,decision:'approve'}),/DECISION_CONFLICT/);
  const retained=(await command('dan_mccuistion','rows',{ids:['row-1']})).rows[0];
  assert.equal(retained.suspend_tag_status,'denied'); assert.equal(retained.date_completed,null);
  for(const [key,value] of Object.entries(patch)) assert.equal(retained[key],value,`${key} survives denial`);
  await assert.rejects(command('dan_mccuistion','complete',{...input,patch:{dock_photo_link:''}},retained.suspend_tag_version),/PHOTO_REQUIRED/);
  const resubmitted=await command('dan_mccuistion','complete',{...input,patch:{dock_note:'Corrected'}},retained.suspend_tag_version);
  assert.equal(resubmitted.row.suspend_tag_status,'awaiting_rep'); assert.notEqual(resubmitted.row.suspend_tag_approval_id,id);
  await assert.rejects(command('toby_brown','decide',{approvalId:id,decision:'approve'}),/SUPERSEDED/);
  const round2=resubmitted.row.suspend_tag_approval_id;
  const concurrentDecision = async decision => {
    const client=new pg.Client(connection);await client.connect();
    try {
      await client.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'service_role'})]);await client.query('set role service_role');
      return (await client.query('select public.suspend_tag_command_v1($1,$2,$3,$4,$5,$6) result',[users.toby_brown.id,'decide',{approvalId:round2,decision},randomUUID(),null,users.toby_brown.session])).rows[0].result;
    } finally { await client.end(); }
  };
  const concurrent=await Promise.allSettled([concurrentDecision('approve'),concurrentDecision('deny')]);
  assert.equal(concurrent.filter(result=>result.status==='fulfilled').length,1);
  assert.match(concurrent.find(result=>result.status==='rejected').reason.message,/DECISION_CONFLICT/);
  const winner=concurrent.find(result=>result.status==='fulfilled').value.decision;
  assert.equal((await concurrentDecision(winner==='approved'?'approve':'deny')).decision,winner);
  assert.equal((await admin('select count(*) from ph_request_delivery_outbox')).rows[0].count,'4','one request and decision per round');
  await actor('toby_brown',true);
  assert.equal((await db.query('select suspend_tag_push_receipt_v1($1,$2,false) sent',[round2,'https://push.test/device1'])).rows[0].sent,false);
  assert.equal((await db.query('select suspend_tag_push_receipt_v1($1,$2,true) sent',[round2,'https://push.test/device1'])).rows[0].sent,true);
  assert.equal((await db.query('select suspend_tag_push_receipt_v1($1,$2,false) sent',[round2,'https://push.test/device1'])).rows[0].sent,true);
  assert.equal((await db.query('select suspend_tag_push_receipt_v1($1,$2,false) sent',[round2,'https://push.test/device2'])).rows[0].sent,false);
  const round2Record=(await admin('select * from suspend_tag_private.approvals where id=$1',[round2])).rows[0];
  const lease=randomUUID();
  await admin("update ph_request_delivery_outbox set status='processing',lease_token=$2 where event_id=$1",[snapshot.request_event_id,lease]);
  await actor('toby_brown',true);
  const lateOriginal=(await db.query('select prepare_suspend_tag_delivery_v1($1,$2) result',[snapshot.request_event_id,lease])).rows[0].result;
  assert.equal(lateOriginal.approval.id,id,'the original email remains recoverable after denial and a newer round');
  assert.equal(lateOriginal.approval.status,'denied');
  await admin("update ph_request_delivery_outbox set status='processing',lease_token=$2 where event_id=$1",[round2Record.decision_event_id,lease]);
  await actor('toby_brown',true);
  await assert.rejects(db.query('select prepare_suspend_tag_delivery_v1($1,$2)',[round2Record.decision_event_id,lease]),/ORIGINAL_EMAIL_PENDING/);
  await admin("update ph_request_delivery_outbox set email_delivered_at=now(),gmail_thread_id='original-thread',message_id_header='<original@test>' where event_id=$1",[round2Record.request_event_id]);
  await actor('toby_brown',true);
  const prepared=(await db.query('select prepare_suspend_tag_delivery_v1($1,$2) result',[round2Record.decision_event_id,lease])).rows[0].result;
  assert.equal(prepared.thread.threadId,'original-thread');assert.equal(prepared.thread.messageId,'<original@test>');
  assert.equal(prepared.approval.snapshot.dock_photo_name,patch.dock_photo_name);
  await admin(`insert into ph_soc_master(unique_id,last_updated,suspend,suspend_to,salesrepname,match,av_note,dock_photo_link,dock_photo_name)
    values('missing-rep',$1,'SUSPEND','DC','Unknown Sales Rep','100','Available','https://example.test/saved.jpg','saved.jpg')`,[revision]);
  const noRep=await command('megan_kelly','complete',{sourceUid:'missing-rep',expectedLastUpdated:revision},0);
  await assert.rejects(command('megan_kelly','send',{sourceUid:'missing-rep',expectedLastUpdated:revision},noRep.row.suspend_tag_version),/REP_EMAIL_MISSING/);
  assert.equal((await command('megan_kelly','rows',{ids:['missing-rep']})).rows[0].suspend_tag_status,'completed','missing routing does not erase completed work');
  await admin(`create table suspend_tag_private.completion_commands(actor_id uuid,source_uid text,source_last_updated timestamptz,completed_at timestamptz,response jsonb,created_at timestamptz default now());
    insert into ph_soc_master(unique_id,last_updated,suspend,suspend_to,date_completed) values('legacy-proven','2026-10-05T12:00:00Z','SUSPEND','DC','2026-10-05T13:00:00Z'),('legacy-unknown','2026-10-05T12:00:00Z','SUSPEND','DC','2026-10-05T13:00:00Z');`);
  await admin("insert into suspend_tag_private.completion_commands(actor_id,source_uid,source_last_updated,completed_at,response) values($1,'legacy-proven',$2,'2026-10-05T13:00:00Z',$3)",[users.dylan_collyge.id,revision,{alreadyCompleted:false}]);
  const migration=fs.readFileSync('supabase/migrations/'+suspendTagApprovalMigrationName,'utf8');
  await admin(migration.slice(migration.indexOf('do $backfill$'),migration.indexOf('end $backfill$;')+'end $backfill$;'.length));
  assert.equal((await admin("select completed_by from suspend_tag_private.workflows where source_uid='legacy-proven'")).rows[0].completed_by,users.dylan_collyge.id);
  await assert.rejects(command('dylan_collyge','send',{sourceUid:'legacy-unknown',expectedLastUpdated:revision},0),/REVIEW_REQUIRED/);
  await assert.rejects(command('megan_kelly','save',{...input,patch:{date_completed:'2027-01-01'}},resubmitted.row.suspend_tag_version),/VERSION_CHANGED|REVIEW_LOCKED|FIELD_FORBIDDEN/);
  await admin("update profiles set disabled_at=now() where username='dan_mccuistion'");
  await actor('dan_mccuistion'); assert.equal((await db.query('select count(*) from ph_soc_master')).rows[0].count,'0');
  await assert.rejects(command('dan_mccuistion','rows',{ids:['row-1']}),/FORBIDDEN/);
  await admin('update auth.sessions set not_after=now()-interval \'1 minute\' where id=$1',[users.megan_kelly.session]);
  await assert.rejects(command('megan_kelly','rows',{ids:['row-1']}),/SESSION_REQUIRED/);
  await actor('dylan_collyge'); await db.query('reset role'); await db.query('delete from auth.sessions where id=$1',[users.dylan_collyge.session]);
  await actor('dylan_collyge'); assert.equal((await db.query('select count(*) from ph_soc_master')).rows[0].count,'0');
  await assert.rejects(command('dylan_collyge','rows',{ids:['row-1']}),/SESSION_REQUIRED/);
  await assert.rejects(command('dylan_collyge','complete',input),/SESSION_REQUIRED/);
  console.log('Suspend Tag PostgreSQL: permissions, atomic completion, retention, approval, denial, validation, resubmission, and stale decisions passed.');
} finally { await db.end(); }
