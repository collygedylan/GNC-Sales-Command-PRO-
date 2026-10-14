// @test-runtime: postgres
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { latestMigrationFunctionDefinition } from '../../scripts/migration-function-source.mjs';

// Runs after suspend_tag_approval.mjs in its disposable postgres test service.
const host = process.env.PGHOST || '127.0.0.1';
if (!['localhost', '127.0.0.1'].includes(host)) throw Error('ISOLATED_DATABASE_REQUIRED');
const connection = { host, port: Number(process.env.PGPORT || 55439), database: process.env.PGDATABASE || 'suspend_tag_test',
  user: 'postgres', password: 'disposable_ci_only' };
const db = new pg.Client(connection);
await db.connect();
try {
  await db.query(latestMigrationFunctionDefinition({ schema: 'suspend_tag_private', name: 'command',
    argumentTypes: ['uuid', 'text', 'jsonb', 'uuid', 'bigint'] }));
  const editor = (await db.query("select id from profiles where username='dylan_collyge'")).rows[0];
  assert.ok(editor, 'approval fixture provides the editor profile');
  const sessionId = randomUUID();
  await db.query("update profiles set disabled_at=null,locked_until=null,must_change_password=false where id=$1", [editor.id]);
  await db.query('insert into auth.sessions(id,user_id,not_after) values($1,$2,null)', [sessionId, editor.id]);

  const actor = async (username = 'dylan_collyge', role = 'service_role') => {
    await db.query('reset role');
    const profile = (await db.query('select id from profiles where username=$1', [username])).rows[0];
    assert.ok(profile, `fixture provides ${username}`);
    const session = username === 'dylan_collyge' ? sessionId
      : (await db.query('select id from auth.sessions where user_id=$1 order by id limit 1', [profile.id])).rows[0]?.id;
    assert.ok(session, `fixture provides active session for ${username}`);
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ iss: 'https://kzrnyjsosryejjejliii.supabase.co/auth/v1',
      sub: profile.id, session_id: session, role, exp: Math.floor(Date.now() / 1000) + 3600 })]);
    await db.query(role === 'service_role' ? 'set role service_role' : 'set role authenticated');
    return { id: profile.id, session };
  };
  const admin = async (sql, args = []) => { await db.query('reset role'); return db.query(sql, args); };
  const command = async (operation, payload, version = 0, commandId = randomUUID(), username = 'dylan_collyge') => {
    const identity = await actor(username);
    return (await db.query('select public.suspend_tag_command_v1($1,$2,$3,$4,$5,$6) as result',
      [identity.id, operation, payload, commandId, version, identity.session])).rows[0].result;
  };
  const revision = new Date().toISOString();
  const photoUpdated = new Date(Date.now() - 86400000).toISOString();
  const specUpdated = new Date(Date.now() - 86400000).toISOString();
  const itemcode = `CLOSE-${randomUUID()}`;
  const locationcode = `TEST.LOC.${randomUUID()}`;
  const lotcode = '27.F1';
  const masterId = randomUUID();
  await admin(`insert into ph_master_inventory(unique_id,itemcode,locationcode,lotcode,contsize,source,photo_link,photo_name,
      spec,caliper,match,av_note,loc_match_qty,initial_ptr,priority,holdstopcode,last_updated,
      av_rule_photo_updated_at,av_rule_spec_updated_at,av_rule_match_updated_at,av_rule_caliper_updated_at,
      av_rule_av_note_updated_at,av_rule_bundle_updated_at,av_rule_priority_snapshot,av_rule_holdstop_snapshot)
    values($1,$2,$3,$4,'#1','MASTER_A','old-photo.jpg','old-photo.jpg','old-spec','old-caliper','20','old-note','1','1','HIGH','HS',
      $5,$6,$7,$6,$7,$7,$7,'HIGH','HS')`, [masterId, itemcode, locationcode, lotcode, revision, photoUpdated, specUpdated]);
  // A second source sharing the tuple proves meaningful master source identity selects one exact row.
  const otherSourceMasterId = randomUUID();
  await admin(`insert into ph_master_inventory(unique_id,itemcode,locationcode,lotcode,contsize,source,photo_link,spec,match,last_updated)
    values($1,$2,$3,$4,'#1','MASTER_B','other-source-photo','other-source-spec','11',$5)`,
  [otherSourceMasterId, itemcode, locationcode, lotcode, revision]);
  const sourceUid = `close-${randomUUID()}`;
  await admin(`insert into ph_soc_master(unique_id,last_updated,suspend,suspend_to,source,itemcode,locationcode,lotcode,contsize,
      salesrepname,holdstopcode,dock_photo_link,dock_photo_name,dock_spec,dock_caliper,dock_note,match,av_note,loc_match_qty,initial_ptr)
    values($1,$2,'SUSPEND','DC','MASTER_A',$3,$4,$5,'#1','Toby Brown','HS','','','','','','','','','')`,
  [sourceUid, revision, itemcode, locationcode, lotcode]);

  const payload = { sourceUid, expectedLastUpdated: revision, patch: {
    dock_photo_link: 'new-photo.jpg', dock_photo_name: 'new-photo.jpg', dock_spec: 'new-spec', dock_caliper: 'new-caliper',
    dock_note: 'tag note', match: '40', av_note: 'available', loc_match_qty: '5', initial_ptr: '10',
  } };
  const saved = await command('save', payload, 0);
  assert.equal(saved.ok, true);
  assert.equal(saved.inventoryRow.unique_id, masterId, 'canonical ack selects source-matched master row');
  assert.equal(saved.inventoryRow.photo_link, 'new-photo.jpg');
  assert.equal(saved.inventoryRow.spec, 'new-spec');
  assert.equal(saved.inventoryRow.match, '40');
  assert.equal(saved.inventoryRow.loc_match_qty, '5');
  assert.ok(saved.inventoryRow.av_rule_photo_updated_at, 'photo evidence timestamp is present');
  assert.ok(saved.inventoryRow.av_rule_spec_updated_at, 'spec evidence timestamp is present');
  assert.ok(saved.inventoryRow.av_rule_match_updated_at, 'match evidence timestamp is present');
  assert.ok(Object.hasOwn(saved.inventoryRow, 'app_tab_assignment'), 'ack returns the full canonical master row');
  assert.equal((await admin('select unique_id from ph_master_inventory where itemcode=$1 and locationcode=$2 and lotcode=$3 and source=$4',
    [itemcode, locationcode, lotcode, 'MASTER_B'])).rows[0].unique_id, otherSourceMasterId, 'nonmatching source row is unchanged');
  const revisionAdvanced = await admin('select last_updated > $2::timestamptz as advanced from ph_master_inventory where unique_id=$1',
    [masterId, revision]);
  assert.equal(revisionAdvanced.rows[0].advanced, true, 'master last_updated advances beyond the exact prior revision');
  await admin(`update ph_master_inventory set av_rule_photo_updated_at=null,av_rule_spec_updated_at=null,
      av_rule_match_updated_at=null,av_rule_caliper_updated_at=null,av_rule_av_note_updated_at=null,av_rule_bundle_updated_at=null
    where unique_id=$1`, [masterId]);
  const repaired = await command('save', { sourceUid, expectedLastUpdated: revision, patch: { dock_note: 'repair missing stamps' } },
    saved.row.suspend_tag_version);
  assert.ok(repaired.inventoryRow.av_rule_photo_updated_at, 'save repairs missing photo stamp when saved photo already matches master');
  assert.ok(repaired.inventoryRow.av_rule_spec_updated_at, 'save repairs missing spec stamp when saved spec already matches master');
  const driveTimestamp = new Date(Date.now() + 1000).toISOString();
  await admin(`update ph_master_inventory set photo_link='drive-new-photo.jpg',spec='drive-new-spec',
      av_rule_photo_updated_at=$2,av_rule_spec_updated_at=$2 where unique_id=$1`, [masterId, driveTimestamp]);

  const notePayload = { sourceUid, expectedLastUpdated: revision, patch: { av_note: 'revised note only' } };
  const noteSaved = await command('save', notePayload, repaired.row.suspend_tag_version);
  assert.equal(noteSaved.inventoryRow.av_note, 'revised note only');
  assert.equal(noteSaved.inventoryRow.photo_link, 'drive-new-photo.jpg', 'note-only save preserves a newer Drive photo');
  assert.equal(noteSaved.inventoryRow.spec, 'drive-new-spec', 'note-only save preserves newer Drive spec');
  assert.equal(Date.parse(noteSaved.inventoryRow.av_rule_photo_updated_at), Date.parse(driveTimestamp), 'note-only save does not renew unrelated photo evidence');
  assert.equal(Date.parse(noteSaved.inventoryRow.av_rule_spec_updated_at), Date.parse(driveTimestamp), 'note-only save does not renew unrelated spec evidence');

  const completed = await command('complete', { sourceUid, expectedLastUpdated: revision }, noteSaved.row.suspend_tag_version);
  assert.equal(completed.row.suspend_tag_status, 'completed');
  const reviewPhotoStamp = completed.inventoryRow.av_rule_photo_updated_at;
  assert.equal(Date.parse(reviewPhotoStamp), Date.parse(driveTimestamp), 'validated complete does not replace newer Drive photo evidence with stale source data');
  const sent = await command('send', { sourceUid, expectedLastUpdated: revision }, completed.row.suspend_tag_version);
  assert.equal(sent.row.suspend_tag_status, 'awaiting_rep');
  const approvalId = sent.row.suspend_tag_approval_id;
  const approval = (await admin('select * from suspend_tag_private.approvals where id=$1', [approvalId])).rows[0];
  const outboxBeforeClose = (await admin('select count(*)::int as n from ph_request_delivery_outbox')).rows[0].n;
  const closeInput = { sourceUid, expectedLastUpdated: revision };
  const closeCommandId = randomUUID();
  const closed = await command('close', closeInput, sent.row.suspend_tag_version, closeCommandId);
  assert.equal(closed.row.suspend_tag_status, 'completed');
  assert.equal(closed.row.suspend, null);
  assert.equal(closed.row.suspend_to, null);
  assert.equal(closed.inventoryRow.unique_id, masterId);
  assert.equal(closed.inventoryRow.av_rule_photo_updated_at, reviewPhotoStamp, 'close alone does not renew the reviewed photo');
  assert.equal((await command('rows', { ids: [sourceUid] })).rows.length, 0, 'closed source disappears from Suspend rows');
  assert.deepEqual(await command('close', closeInput, sent.row.suspend_tag_version, closeCommandId), closed,
    'close retries replay the saved receipt after the source is no longer eligible');
  assert.equal((await admin('select status from suspend_tag_private.approvals where id=$1', [approvalId])).rows[0].status,
    'superseded', 'close cancels the pending rep approval');
  assert.equal((await admin('select count(*)::int as n from ph_request_delivery_outbox')).rows[0].n, outboxBeforeClose,
    'close creates no email or decision event');
  await assert.rejects(command('decide', { approvalId, decision: 'approve' }, null, randomUUID(), 'toby_brown'),
    /APPROVAL_SUPERSEDED/, 'late rep decision is rejected after close');
  const lease = randomUUID();
  await admin("update ph_request_delivery_outbox set status='processing',lease_token=$2 where event_id=$1", [approval.request_event_id, lease]);
  await actor();
  const lateDelivery = (await db.query('select public.prepare_suspend_tag_delivery_v1($1,$2) as result', [approval.request_event_id, lease])).rows[0].result;
  assert.equal(lateDelivery.suppressed, true, 'late delivery callback is suppressed after close supersedes the approval');

  const holdItem = `HOLD-${randomUUID()}`;
  const holdLocation = `HOLD.LOC.${randomUUID()}`;
  const holdUid = `hold-${randomUUID()}`;
  const approvedAt = new Date(Date.now() - 86400000).toISOString();
  const currentHoldBegin = new Date(Date.now() + 86400000).toISOString();
  await admin(`insert into ph_master_inventory(unique_id,itemcode,locationcode,lotcode,contsize,source,holdstopcode,holdstopbegindate,
      hold_release_approved_at,hold_release_approved_holdstopbegindate,spec,caliper,match,av_note,last_updated)
    values($1,$2,$3,'27.F1','#1','MASTER_A','HS',$4,$5,$6,'old','caliper','10','available',$7)`,
  [randomUUID(), holdItem, holdLocation, currentHoldBegin, approvedAt, new Date(Date.now() - 172800000).toISOString(), revision]);
  await admin(`insert into ph_soc_master(unique_id,last_updated,suspend,suspend_to,source,itemcode,locationcode,lotcode,contsize,
      dock_spec,dock_caliper,match,av_note)
    values($1,$2,'SUSPEND','DC','MASTER_A',$3,$4,'27.F1','#1','new','caliper','10','available')`,
  [holdUid, revision, holdItem, holdLocation]);
  const holdSave = await command('save', { sourceUid: holdUid, expectedLastUpdated: revision, patch: { dock_spec: 'new' } }, 0);
  assert.equal(holdSave.inventoryRow.av_rule_holdstop_snapshot, 'HS',
    'a new current hold after approval stays blocking even when its stored prior hold date is older');
  const pastHoldBegin = new Date(Date.now() - 172800000).toISOString();
  await admin('update ph_master_inventory set holdstopbegindate=$2 where itemcode=$1', [holdItem, pastHoldBegin]);
  const releasedSave = await command('save', { sourceUid: holdUid, expectedLastUpdated: revision, patch: { dock_spec: 'newer' } },
    holdSave.row.suspend_tag_version);
  assert.equal(releasedSave.inventoryRow.av_rule_holdstop_snapshot, '', 'an approved matching hold date releases the blocking snapshot');

  const staleSourceUid = `stale-close-${randomUUID()}`;
  const staleRevision = new Date(Date.now() - 60000).toISOString();
  const currentRevision = new Date().toISOString();
  await admin(`insert into ph_soc_master(unique_id,last_updated,suspend,suspend_to,source,itemcode,locationcode,lotcode,contsize,
      salesrepname,holdstopcode,dock_photo_link,dock_photo_name,dock_spec,dock_caliper,match,av_note)
    values($1,$2,'SUSPEND','DC','MASTER_A',$3,$4,$5,'#1','Toby Brown','HS','stale.jpg','stale.jpg','stale spec','stale caliper','10','available')`,
  [staleSourceUid, currentRevision, itemcode, locationcode, lotcode]);
  await assert.rejects(command('close', { sourceUid: staleSourceUid, expectedLastUpdated: staleRevision }, 0), /SOURCE_CHANGED/,
    'stale source revision cannot close');
  assert.equal((await admin('select suspend from ph_soc_master where unique_id=$1', [staleSourceUid])).rows[0].suspend, 'SUSPEND');
  assert.equal((await admin('select count(*)::int as n from suspend_tag_private.workflows where source_uid=$1', [staleSourceUid])).rows[0].n, 0,
    'stale revision does not create or mutate workflow state');
  const firstSave = await command('save', { sourceUid: staleSourceUid, expectedLastUpdated: currentRevision, patch: { dock_note: 'saved' } }, 0);
  await assert.rejects(command('close', { sourceUid: staleSourceUid, expectedLastUpdated: currentRevision }, firstSave.row.suspend_tag_version - 1),
    /VERSION_CHANGED/, 'stale workflow version cannot close');
  assert.equal((await admin('select suspend from ph_soc_master where unique_id=$1', [staleSourceUid])).rows[0].suspend, 'SUSPEND');
  assert.equal((await admin('select status from suspend_tag_private.workflows where source_uid=$1', [staleSourceUid])).rows[0].status, 'pending',
    'stale version leaves workflow unchanged');

  const reopenedRevision = new Date(Date.now() + 5000).toISOString();
  await admin(`update ph_soc_master set last_updated=$2,suspend='SUSPEND',suspend_to='DC',dock_photo_link='reopened.jpg',
      dock_photo_name='reopened.jpg',dock_spec='reopened spec',dock_caliper='reopened caliper',match='12',av_note='available'
    where unique_id=$1`, [sourceUid, reopenedRevision]);
  const reopened = await command('save', { sourceUid, expectedLastUpdated: reopenedRevision, patch: { dock_note: 'new import episode' } },
    closed.row.suspend_tag_version);
  assert.equal(reopened.row.suspend_tag_status, 'pending', 'new import revision with restored Suspend eligibility starts a fresh episode');
  assert.equal(reopened.row.suspend_tag_approval_id, null, 'reopened episode does not reuse canceled approval');

  const ambiguousItem = `AMBIG-${randomUUID()}`;
  const ambiguousLocation = `AMBIG.LOC.${randomUUID()}`;
  const ambiguousLot = '27.F1';
  const ambiguousUid = `ambiguous-${randomUUID()}`;
  await admin(`insert into ph_master_inventory(unique_id,itemcode,locationcode,lotcode,contsize,source,last_updated)
    values($1,$2,$3,$4,'#1','MASTER_A',$5),($6,$2,$3,$4,'#1','MASTER_A',$5)`,
  [randomUUID(), ambiguousItem, ambiguousLocation, ambiguousLot, revision, randomUUID()]);
  await admin(`insert into ph_soc_master(unique_id,last_updated,suspend,suspend_to,source,itemcode,locationcode,lotcode,contsize,
      match,av_note,dock_photo_link,dock_photo_name,dock_spec)
    values($1,$2,'SUSPEND','DC','MASTER_A',$3,$4,$5,'#1','40','available','ambiguous.jpg','ambiguous.jpg','ambiguous spec')`,
  [ambiguousUid, revision, ambiguousItem, ambiguousLocation, ambiguousLot]);
  const ambiguousSave = await command('save', { sourceUid: ambiguousUid, expectedLastUpdated: revision,
    patch: { match: '40', av_note: 'available', dock_photo_link: 'ambiguous.jpg', dock_photo_name: 'ambiguous.jpg', dock_spec: 'ambiguous spec' } }, 0);
  assert.equal(ambiguousSave.inventoryRow, null, 'ambiguous save does not guess at a master inventory row');
  await assert.rejects(command('close', { sourceUid: ambiguousUid, expectedLastUpdated: revision }, ambiguousSave.row.suspend_tag_version),
    /INVENTORY_AMBIGUOUS/, 'close rejects ambiguous exact inventory identity atomically');
  assert.equal((await admin('select suspend from ph_soc_master where unique_id=$1', [ambiguousUid])).rows[0].suspend,
    'SUSPEND', 'ambiguous close leaves source eligible');

  await assert.rejects(command('close', { sourceUid, expectedLastUpdated: revision }, closed.row.suspend_tag_version, randomUUID(), 'jd_jones'),
    /FORBIDDEN/, 'noneditor cannot close a tag');
  await actor('toby_brown', 'authenticated');
  await db.query('reset role');
  await assert.rejects(db.query("select public.suspend_tag_command_v1($1,'close','{}'::jsonb,$2,0,$3)",
    [(await db.query("select id from profiles where username='toby_brown'")).rows[0].id, randomUUID(),
      (await db.query("select id from auth.sessions where user_id=(select id from profiles where username='toby_brown') order by id limit 1")).rows[0].id]),
  /SERVICE_REQUIRED/, 'authenticated cannot invoke the service-only command wrapper');
  console.log('Suspend Tag close PostgreSQL: canonical sync, exact source matching, evidence freshness, close/replay, approval cancellation, stale revision/version, reopen, late rep/delivery callbacks, ambiguity rollback, and permissions passed.');
} finally {
  await db.end();
}
