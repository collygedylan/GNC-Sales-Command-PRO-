import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const root = args[args.indexOf('--pglite-root') + 1];
if (!args.includes('--pglite-root') || !root) throw new Error('Pass --pglite-root');
const require = createRequire(path.join(path.resolve(root), 'package.json'));
const { PGlite } = require('@electric-sql/pglite');
const database = new PGlite();
const admin = '00000000-0000-4000-8000-000000000001';
const rep = '00000000-0000-4000-8000-000000000002';
const foreign = '00000000-0000-4000-8000-000000000003';
const historyOnly = '00000000-0000-4000-8000-000000000004';
const originalPhoto = 'https://example.test/full-resolution.jpg';
const deletedPhoto = 'https://example.test/2024-02-04/request-full-resolution.jpg';
const unverifiedPhoto = 'https://example.test/deleted-without-verification.jpg';
const driveFileId = 'drive-verified_01';
const archivedPhoto = `https://drive.google.com/file/d/${driveFileId}/view`;
const storageRoot = 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1';
const objectKey = 'location_sales_notes_photos/archive/rose.webp';
const objectSource = `${storageRoot}/object/public/${objectKey}`;
const objectAlias = '/storage/v1/object/sign/location_sales_notes_photos/archive/%72ose.webp?token=archive';
const objectSourceKey = createHash('sha256').update(objectKey).digest('hex');
const objectDriveId = 'drive-canonical_01';
const photoHash = 'a'.repeat(64);
const revision = 'history-fast-v2366:ph_requests_completed_history:42,ph_requests_pending:7';

function loadFunction(file, name) {
  const sql = fs.readFileSync(path.join('supabase/migrations', file), 'utf8').replace(/\r\n/g, '\n');
  const start = sql.indexOf(`create or replace function ${name}(`);
  const end = sql.indexOf('\n$function$;', start);
  assert.ok(start >= 0 && end > start, `missing ${name}`);
  return sql.slice(start, end + '\n$function$;'.length);
}

async function seedAuthority() {
  await database.exec(`create schema private;create schema sales_private;create role anon;create role authenticated;create role service_role;
    create table public.profiles(id uuid primary key,role text,disabled_at timestamptz,must_change_password boolean,locked_until timestamptz);
    insert into public.profiles values('${admin}','Admin',null,false,null),('${rep}','Rep',null,false,null),
      ('${foreign}','Rep',now(),false,null),('${historyOnly}','Eval',null,false,null);
    create table public.app_dataset_revisions(key text primary key,revision bigint);
    insert into public.app_dataset_revisions values('ph_requests_completed_history',42),('ph_requests_pending',7),('unrelated',90);
    create function private.navigation_module_allowed_v1(p_actor uuid,p_view text) returns boolean
      language sql stable as $$select p_actor in('${admin}','${rep}') or (p_actor='${historyOnly}' and p_view='request-history')$$;
    create function private.history_dylan_financial_v1(p_actor uuid) returns boolean
      language sql stable as $$select p_actor='${admin}'$$;
    create function public.historical_requests_read_v2370(p_actor uuid,p_query jsonb) returns jsonb
      language plpgsql as $$begin raise exception 'LEGACY_REP_AGGREGATION_CALLED'; end$$;
    create function public.historical_archive_read_v2368(p_query jsonb) returns jsonb
      language sql stable as $$select jsonb_build_object('kind',p_query->>'recordKind',
        'actor',current_setting('request.jwt.claim.sub',true),'claims',current_setting('request.jwt.claims',true)::jsonb)$$;`);
  await database.exec(loadFunction('20261011224500_normalize_sales_actor_role_boundaries.sql', 'sales_private.actor'));
}

async function seed() {
  await seedAuthority();
  await database.exec(`create table public.ph_requests_completed_history(id bigint,unique_id text,assigned_rep_id uuid,
      sales_rep text,customer_name text,customername text,consignee_name text,consigneename text,
      request_folder text,requested_at timestamptz,created_at timestamptz,
      date_completed timestamptz,itemcode text,commonname text,locationcode text,lotcode text,contsize text,
      request_qty numeric,effective_qty numeric,unit_list_price numeric,listprice numeric,line_dollar_value numeric,
      spec text,photo_url text,req_photo_link text,photo_link text,photos jsonb);
    alter table public.ph_requests_completed_history enable row level security;
    create table public.ph_photo_archive_jobs(source_key text primary key,source_url text,status text,source_bucket text,source_path text,
      drive_file_id text,verified_at timestamptz,deleted_at timestamptz,sha256 text);`);
  await database.exec(loadFunction('20261025220000_agdata_v2366_historical_archive.sql', 'private.archive_photo_array_v2366'));
  await database.query(`insert into public.ph_requests_completed_history(id,unique_id,assigned_rep_id,
    sales_rep,customer_name,consignee_name,request_folder,requested_at,date_completed,itemcode,commonname,request_qty,
    unit_list_price,line_dollar_value,spec,photo_url,req_photo_link,photos)
    values(1,'REQ-1',$1,'Alpha Rep','Buying Account','N/A','Retained Pickup Folder','2024-02-03','2024-02-04','00123','Rose',25,10,250,'24 H',$2,$4,
      jsonb_build_array(jsonb_build_object('photoUrl',$5::text))),
    (2,'REQ-2',$3,'Beta Rep','Other Buyer','Receiving Store','Private Archive Folder','2023-03-12','2023-03-14','00077','Oak',8,15,120,'40 H',$2,null,null)`,
  [rep, originalPhoto, foreign, deletedPhoto, unverifiedPhoto]);
  await database.query(`insert into public.ph_photo_archive_jobs(source_key,source_url,status,drive_file_id,verified_at,deleted_at,sha256)
    values('photos:original',$1,'quarantined','drive_retained','2024-02-10',null,$5),
      ('photos:deleted',$2,'deleted',$4,'2024-02-10','2024-03-10',$5),
      ('photos:unverified',$3,'deleted','drive_unverified',null,'2024-03-10',$5)`,
  [originalPhoto, deletedPhoto, unverifiedPhoto, driveFileId, photoHash]);
  await database.query(`update public.ph_requests_completed_history
    set photos=photos||jsonb_build_array(jsonb_build_object('href',$1::text)) where unique_id='REQ-1'`, [objectAlias]);
  await database.query(`insert into public.ph_photo_archive_jobs(source_key,source_url,status,drive_file_id,verified_at,
    deleted_at,sha256,source_bucket,source_path)
    values($1,$2,'deleted',$3,'2024-02-10','2024-03-10',$4,'location_sales_notes_photos','archive/rose.webp')`,
  [objectSourceKey, objectSource, objectDriveId, photoHash]);
}

async function archive(actor, operation, query = {}) {
  return (await database.query('select public.historical_archive_read_v2370($1,$2) page',
    [actor, { operation, recordKind: 'requests', ...query }])).rows[0].page;
}

function provePhotoReceipts(record) {
  assert.deepEqual(record.photoLinks, [`https://drive.google.com/file/d/${objectDriveId}/view`, archivedPhoto, unverifiedPhoto, originalPhoto]);
  const dates = { verifiedAt: '2024-02-10T00:00:00+00:00', deletedAt: '2024-03-10T00:00:00+00:00', sha256: photoHash };
  assert.deepEqual(record.photoArchiveReceipts, [
    { sourceUrl: objectAlias, sourceKey: objectSourceKey, driveFileId: objectDriveId, ...dates },
    { sourceUrl: deletedPhoto, sourceKey: 'photos:deleted', driveFileId, ...dates },
  ]);
}

async function provePhotoQueueIdentity() {
  const sql = `select request_archive_paths paths,request_archive_identity_verified verified
    from public.ph_photo_archive_queue where source_key=$1`;
  const path = ['Alpha Rep', 'Buying Account', 'Direct_or_NA', '2024-02-03_REQ-1', '00123'];
  assert.deepEqual((await database.query(sql, [objectSourceKey])).rows[0], { paths: [path], verified: true });
  assert.deepEqual((await database.query(sql, ['photos:deleted'])).rows[0], { paths: [], verified: false });
  await database.exec('begin');
  try {
    await database.query(`update public.ph_requests_completed_history set photos=photos||jsonb_build_array($1::text)
      where unique_id='REQ-1'`, [`${storageRoot}/object/public/request_photos/bad-%ZZ.webp`]);
    assert.deepEqual((await database.query(sql, [objectSourceKey])).rows[0], { paths: [path], verified: false });
  } finally { await database.exec('rollback'); }
}

async function proveDrillAndScopes() {
  await database.exec('set role service_role');
  try {
    const own = await archive(rep, 'archive-folders');
    assert.deepEqual(own.rows.map(row => row.value), ['Alpha Rep']);
    assert.equal(own.financials, false);
    assert.equal(own.revision, revision);
    assert.equal(own.ownRepKey, `rep:${rep}`);
    assert.equal(own.rows[0].totalValue, null);
    const global = await archive(admin, 'archive-folders');
    assert.deepEqual(global.rows.map(row => row.value), ['Alpha Rep', 'Beta Rep']);
    const archivePath = ['Alpha Rep', 'Buying Account', 'Direct_or_NA', '2024-02-03_REQ-1', '00123'];
    for (let depth = 0; depth < archivePath.length; depth++) {
      const result = await archive(rep, 'archive-folders', { path: archivePath.slice(0, depth) });
      assert.equal(result.rows[0].value, archivePath[depth]);
    }
    const leaf = await archive(rep, 'archive-records', { path: archivePath });
    assert.equal(leaf.rows[0].quantity, 25);
    assert.equal(leaf.rows[0].facts.Spec, '24 H');
    provePhotoReceipts(leaf.rows[0]);
    assert.equal(leaf.rows[0].unitListPrice, null);
    assert.equal((await archive(rep, 'archive-search', { query: 'Receiving Store' })).rows.length, 0);
    assert.equal((await archive(admin, 'archive-search', { query: 'Receiving Store' })).rows[0].lineDollarValue, 120);
    await assert.rejects(archive(rep, 'archive-records', { path: ['Alpha Rep'] }), /ARCHIVE_PATH_INVALID/);
    await assert.rejects(archive(rep, 'archive-folders', { actorId: admin }), /ARCHIVE_QUERY_INVALID/);
    await assert.rejects(archive(foreign, 'archive-folders'), /SALES_ACTOR_NOT_ACTIVE/);
    await assert.rejects(archive(historyOnly, 'archive-folders'), /HISTORICAL_REQUESTS_FORBIDDEN/);
    assert.equal((await archive(historyOnly, 'archive-folders', { view: 'request-history' })).total, 0);
    const legacy = await archive(rep, 'archive-records', { recordKind: 'orders' });
    assert.deepEqual(legacy, { kind: 'orders', actor: rep, claims: { sub: rep, role: 'authenticated' } });
  } finally { await database.exec('reset role'); }
  await database.exec('set role authenticated');
  try { await assert.rejects(archive(admin, 'archive-folders'), /permission denied/); }
  finally { await database.exec('reset role'); }
}

async function proveRequestSearchCompatibility() {
  await database.exec('set role service_role');
  try {
    const oldSearch = { query: 'retained pickup folder', page: 0, pageSize: 25 };
    const legacy = await archive(rep, 'archive-search', oldSearch);
    assert.deepEqual(legacy.rows.map(row => row.id), ['REQ-1']);
    assert.equal(legacy.rows[0].facts.Folder, 'Retained Pickup Folder');
    assert.deepEqual((await archive(rep, 'archive-search', { query: '00123 Rose' })).rows.map(row => row.id), ['REQ-1']);
    assert.equal((await archive(rep, 'archive-search', { query: 'Private Archive Folder' })).total, 0);
    assert.equal((await archive(admin, 'archive-search', { query: 'Private Archive Folder' })).rows[0].id, 'REQ-2');
    const path = ['Alpha Rep', 'Buying Account', 'Direct_or_NA', '2024-02-03_REQ-1', '00123'];
    const canonical = await archive(rep, 'archive-search', { query: path.join(' ') });
    assert.deepEqual(canonical.rows, legacy.rows);
    assert.deepEqual(canonical.rows[0].archivePath, path);
  } finally { await database.exec('reset role'); }
}

async function proveIndexes() {
  await database.exec(`insert into public.ph_requests_completed_history(id,unique_id,customer_name,consignee_name)
    select value,'filler-'||value,'Customer '||value,'Consignee '||value from generate_series(10,5000) value;
    insert into public.ph_photo_archive_jobs(source_key,source_url,status)
    select 'photo:'||value,'https://example.test/filler-'||value,'pending' from generate_series(10,5000) value;
    analyze public.ph_requests_completed_history; analyze public.ph_photo_archive_jobs;`);
  const timings = {};
  for (const [field, value] of [['customer_name', 'buying account'], ['consignee_name', 'receiving store']]) {
    const explain = (await database.query(`explain (analyze,format json) select unique_id
      from public.ph_requests_completed_history where lower(${field})=$1`, [value])).rows[0]['QUERY PLAN'];
    assert.match(JSON.stringify(explain), new RegExp(`ph_request_history_${field}_v3039`));
    timings[field] = explain[0]['Execution Time'];
  }
  const explain = (await database.query(`explain (analyze,format json) select source_key
    from public.ph_photo_archive_jobs where source_url=$1 and status='deleted'`, [deletedPhoto])).rows[0]['QUERY PLAN'];
  assert.match(JSON.stringify(explain), /ph_photo_archive_jobs_source_url_v3039/);
  timings.photo_source_url = explain[0]['Execution Time'];
  return timings;
}

const partyLookupSql = 'select public.historical_request_party_lookup_v3039($1,$2,$3,25) result';

async function partyLookup(actor, customer, consignee) {
  return (await database.query(partyLookupSql, [actor, customer, consignee])).rows[0].result;
}

async function measureAuthorizedPartyLookup(actor, customer, consignee, expectedId) {
  const input = [actor, customer, consignee];
  const samples = [];
  for (let run = 0; run < 9; run++) {
    const explain = (await database.query(`explain (analyze,format json) ${partyLookupSql}`, input)).rows[0]['QUERY PLAN'];
    samples.push(explain[0]['Execution Time']);
  }
  const median = samples.sort((a, b) => a - b)[4];
  assert.ok(median > 0 && median < 25, `authorized local party lookup median ${median} ms`);
  assert.equal((await partyLookup(...input)).rows[0].id, expectedId);
  return median;
}

async function proveExactPartyLookups() {
  await database.exec('set role service_role');
  try {
    const own = await partyLookup(rep, 'buying account', null);
    assert.equal(own.returnedCount, 1);
    assert.equal(own.rows[0].unitListPrice, null);
    provePhotoReceipts(own.rows[0]);
    assert.equal((await partyLookup(rep, null, 'Receiving Store')).returnedCount, 0);
    await assert.rejects(partyLookup(foreign, null, 'Receiving Store'), /SALES_ACTOR_NOT_ACTIVE/);
    await assert.rejects(partyLookup(historyOnly, null, 'Receiving Store'), /HISTORICAL_REQUESTS_FORBIDDEN/);
    return {
      customer_own: await measureAuthorizedPartyLookup(rep, 'buying account', null, 'REQ-1'),
      consignee_all: await measureAuthorizedPartyLookup(admin, null, 'receiving store', 'REQ-2'),
    };
  } finally { await database.exec('reset role'); }
}

try {
  await seed();
  for (const file of ['20261109002000_agdata3039_request_archive_catalog.sql',
    '20261109008000_agdata3039_request_archive_reader.sql']) {
    await database.exec(fs.readFileSync(path.join('supabase/migrations', file), 'utf8'));
  }
  await proveDrillAndScopes();
  await proveRequestSearchCompatibility();
  await provePhotoQueueIdentity();
  const indexedLookupMs = await proveIndexes();
  const authorizedRpcMedianMs = await proveExactPartyLookups();
  process.stdout.write(`PASS: archive routing, legacy and canonical search, exact photo receipts, scope denial; local ${JSON.stringify({ indexedLookupMs, authorizedRpcMedianMs })}.\n`);
} catch (error) {
  process.stderr.write(JSON.stringify({ message: error.message, detail: error.detail, where: error.where }) + '\n');
  process.exitCode = 1;
} finally {
  await database.close();
}
