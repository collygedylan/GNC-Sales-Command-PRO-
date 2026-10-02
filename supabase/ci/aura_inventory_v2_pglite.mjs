// Local SQL contract test for the AURA V2 service-only inventory RPC. This
// exercises the checked-in migration in isolated PGlite and never connects to
// a configured Supabase project.
// node supabase/ci/aura_inventory_v2_pglite.mjs --pglite-root .gnc-local/pglite
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const args = process.argv.slice(2);
const dependencyRoot = args[args.indexOf('--pglite-root') + 1];
if (!args.includes('--pglite-root') || !dependencyRoot) throw Error('Pass --pglite-root');
const requireFromDependencies = createRequire(path.join(path.resolve(dependencyRoot), 'package.json'));
const { PGlite } = requireFromDependencies('@electric-sql/pglite');
const { pg_trgm } = requireFromDependencies(path.join(path.resolve(dependencyRoot), 'node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.cjs'));
const db = new PGlite({ extensions: { pg_trgm } });
const migration = fs.readFileSync(new URL('../migrations/20261002121446_aura_inventory_v2_007.sql', import.meta.url), 'utf8');
const matchMigration = fs.readFileSync(new URL('../migrations/20261002204108_aura_inventory_match_010.sql', import.meta.url), 'utf8');
const query = async (sql, params = []) => (await db.query(sql, params)).rows;

try {
  await db.waitReady;
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema extensions;
    create table public.ph_app_settings(key text primary key,value jsonb);
    insert into public.ph_app_settings values('current_season_salesyear','{"seasonCode":"F1","salesYear":"27"}'::jsonb);
    create table public.ph_master_inventory(
      unique_id text primary key,itemcode text,commonname text,contsize text,locationcode text,lotcode text,
      ptravailable text,ptronhand text,s_lts text,priority text,season text,saleyear text,desigitem text,app_tab_assignment text
    );
    grant select on public.ph_app_settings,public.ph_master_inventory to service_role;
    insert into public.ph_master_inventory values
      ('u1','3DP','Little Hotties','#3','U1','26.F1','100','120','80','2','F1','26','',''),
      ('u2','3DP','Little Hotties','#3','U2','26.F1','200','220','150','1','F1','2027','',''),
      ('u3','3DP','Little Hotties','#3','U2','27.F1','50','55','40','bad','F1','27','',''),
      ('future','3DP','Little Hotties','#3','U3','28.F1','bad','bad','999','0','F1','28','',''),
      ('future-unknown-open','3DP','Little Hotties','#3','U2','29.F1','bad','bad','bad','1','F1','28','',''),
      ('u4','7DP','U2 Only','#1','U2','26.U2','300','305','2','3','U2','27','',''),
      ('u5','3DP','Little Hotties','#3','U2','28.F1','120','125','50','bad','F1','27','',''),
      ('closed-bad','9DP','Closed Unknown','#1','U2','27.F1','bad','bad','0','0','F1','27','',''),
      ('missing-available','10DP','Unknown Available','#1','U1','27.F1','bad','15','1','1','F1','27','',''),
      ('alias','3DP','Little Hotties Alias','#3','','','5','6','1','4','F1','27','',''),
      ('unknown-metric','8DP','Unknown Quantity','#1','U1','26.F1','bad','20','2','1','F1','27','',''),
      ('tie-b','TIEB','Tie B','#1','U1','26.U3','100','100','10','1','U3','27','',''),
      ('tie-a','TIEA','Tie A','#1','U1','26.U3','100','100','10','2','U3','27','',''),
      ('denied','3DP','Little Hotties','#3','U3','26.F1','999','999','999','0','F1','26','','not_on_inventory_denied'),
      ('shift','3DP','Little Hotties','#3','U3','26.F1','999','999','999','0','F1','26','SHFT',''),
      ('aura-gem-1','BABYGEM01','Baby Gem Boxwood','3DP','AURA-U1','27.U3','14','18','2','1','U3','27','',''),
      ('aura-gem-2','BABYGEM01','Baby Gem Boxwood','3DP','AURA-U2','27.U3','20','22','3','1','U3','27','',''),
      ('aura-gem-compact','BABYGEM02','Baby Gem Boxwood Compact','3DP','AURA-U1','27.U3','6','9','1','2','U3','27','',''),
      ('aura-gem-wrong-size','BABYGEM03','Baby Gem Boxwood','5DP','AURA-U1','27.U3','6','9','1','2','U3','27','',''),
      ('aura-oak','OAK001','Northern Heritage Oak','3DP','AURA-OAK','27.U3','11','13','2','1','U3','27','',''),
      ('other','5DP','Annabelle','#3','U1','26.F1','500','700','400','1','F1','26','','');
  `);
  await db.exec(migration);
  await db.exec(matchMigration);

  const call = async params => (await query(`select public.aura_inventory_v2_read_v1(
    $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb
  ) data`, params))[0].data;
  await db.exec('set role service_role');
  const exactBabyGem = await query(`select public.aura_inventory_v2_match_v1('Baby Gem Boxwood','3DP','AURA-U2','ptravailable',true,'U3') data`);
  assert.equal(exactBabyGem[0].data.complete, true);
  assert.equal(exactBabyGem[0].data.exactMatch, true);
  assert.equal(exactBabyGem[0].data.rows.length, 1);
  assert.equal(exactBabyGem[0].data.rows[0].itemcode, 'BABYGEM01');
  assert.equal(exactBabyGem[0].data.rows[0].contsize, '3DP');
  const keywordBabyGem = await query(`select public.aura_inventory_v2_match_v1('Baby Gem Boxwood','3DP','AURA-U1','ptravailable',true,'U3') data`);
  assert.equal(keywordBabyGem[0].data.exactMatch, false, 'competing keyword candidate requires explicit choice');
  assert.equal(keywordBabyGem[0].data.rows.length, 2);
  assert.equal(keywordBabyGem[0].data.rows[0].matchKind, 'exact');
  assert.equal(keywordBabyGem[0].data.rows[1].matchKind, 'keyword');
  const fuzzyBabyGem = await query(`select public.aura_inventory_v2_match_v1('Baby Gen Boxwood','3DP','AURA-U2','ptravailable',true,'U3') data`);
  assert.equal(fuzzyBabyGem[0].data.rows[0].matchKind, 'fuzzy');
  const shortKeyword = await query(`select public.aura_inventory_v2_match_v1('Oak','3DP','AURA-OAK','ptravailable',true,'U3') data`);
  assert.equal(shortKeyword[0].data.rows.length, 1, 'a short word can match a long cultivar name');
  assert.equal(shortKeyword[0].data.rows[0].itemcode, 'OAK001');
  assert.equal(shortKeyword[0].data.rows[0].matchKind, 'keyword');
  const noBabyGem = await query(`select public.aura_inventory_v2_match_v1('Baby Gem Boxwood','4DP','AURA-U2','ptravailable',true,'U3') data`);
  assert.deepEqual(noBabyGem[0].data.rows, []);
  assert.equal(noBabyGem[0].data.complete, true);
  await db.exec(`reset role; insert into public.ph_master_inventory values('aura-gem-unknown-year','BABYGEM04','Baby Gem Boxwood','3DP','AURA-UNKNOWN','27.U3','6','9','1','2','U3','unknown','',''); set role service_role`);
  const incompleteBabyGem = await query(`select public.aura_inventory_v2_match_v1('Baby Gem Boxwood','3DP','AURA-UNKNOWN','ptravailable',true,'U3') data`);
  assert.equal(incompleteBabyGem[0].data.complete, false, 'unknown sales-year candidates make matching incomplete');
  assert.equal(incompleteBabyGem[0].data.exactMatch, false, 'incomplete scope cannot auto-select');
  await db.exec(`reset role; delete from public.ph_master_inventory where unique_id='aura-gem-unknown-year'; set role service_role`);
  await db.exec(`reset role; insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptravailable,ptronhand,s_lts,priority,season,saleyear,desigitem,app_tab_assignment)
    select 'aura-cap-'||n,'AURACAP'||lpad(n::text,2,'0'),'AURA Cap Test Plant','3DP','AURA-MATCH-CAP','27.U3','1','1','1','1','U3','27','',''
    from generate_series(1,8) n; set role service_role`);
  const boundedMatches = await query(`select public.aura_inventory_v2_match_v1('AURA Cap Test Plant','3DP','AURA-MATCH-CAP','ptravailable',true,'U3') data`);
  assert.equal(boundedMatches[0].data.rows.length, 5, 'at most five choices are returned');
  assert.equal(boundedMatches[0].data.additionalMatches, true, 'truncated candidate list flags additional matches');
  assert.equal(boundedMatches[0].data.complete, true, 'additional results are distinguished from incomplete source data');
  const firstCatalog = await call(['catalog',null,null,null,'ptravailable',false,null,null,null,1,'[]']);
  assert.equal(firstCatalog.complete, true);
  assert.equal(firstCatalog.hasMore, true);
  assert.equal(firstCatalog.rows.length, 1);
  const secondCatalog = await call(['catalog',null,null,null,'ptravailable',false,null,'F1',JSON.stringify(firstCatalog.nextCursor),1,'[]']);
  assert.equal(secondCatalog.rows.length, 1);
  assert.notEqual(firstCatalog.rows[0].itemcode, secondCatalog.rows[0].itemcode);
  await db.exec(`reset role; insert into public.ph_master_inventory values('unknown-year','11DP','Unknown Year','#1','U9','26.F1','40','50','2','1','F1','not-a-year','',''); set role service_role`);

  const firstCount = await call(['count','3DP','#3',null,'ptravailable',false,null,'F1',null,2,'[]']);
  assert.equal(firstCount.complete, true);
  assert.equal(firstCount.total, 475);
  assert.equal(firstCount.rows.length, 2);
  assert.equal(firstCount.hasMore, true);
  const nextCount = await call(['count','3DP','#3',null,'ptravailable',false,null,'F1',JSON.stringify(firstCount.nextCursor),2,'[]']);
  assert.equal(nextCount.rows.length, 2);
  assert.equal(nextCount.rows[0].unique_id,'u2');

  const maximum = await call(['maximum',null,'#3','U2','ptravailable',true,null,'F1',null,100,'[]']);
  assert.equal(maximum.complete, true);
  assert.equal(maximum.winner.itemcode,'3DP');
  assert.equal(maximum.winner.total,370);
  assert.equal(maximum.tieCount,1);
  const selectedU2 = await call(['count','7DP','#1','U2','ptravailable',false,null,'U2',null,100,'[]']);
  assert.equal(selectedU2.complete,true,'an explicit supported non-active season should be queryable');
  assert.equal(selectedU2.total,300);
  const u2Maximum = await call(['maximum',null,'#1','U2','ptravailable',false,null,'U2',null,100,'[]']);
  assert.equal(u2Maximum.complete,true);
  assert.equal(u2Maximum.winner.itemcode,'7DP');
  assert.equal(u2Maximum.winner.total,300);
  const scopedMaximum = await call(['maximum',null,'#3','U2','ptravailable',true,null,'F1',null,100,'[]']);
  assert.equal(scopedMaximum.winner.itemcode,'3DP');
  assert.equal(scopedMaximum.winner.total,370,'maximum aggregates aliases by SKU and canonical size within location');
  assert.equal(scopedMaximum.complete,true,'known closed rows with unknown metrics do not poison open-stock maximum');
  await db.exec(`reset role; update public.ph_master_inventory set saleyear='unknown' where unique_id='closed-bad'; set role service_role`);
  for (const operation of ['count','lots','maximum']) {
    const closed = await call([operation,operation === 'maximum' ? null : '9DP','#1','U2','ptravailable',true,operation === 'lots' ? 1 : null,'F1',null,100,'[]']);
    assert.equal(closed.complete,true,'known zero open stock excludes a row even if its year is unknown');
  }
  await db.exec(`reset role; insert into public.ph_master_inventory values('bad-identity','','','','U9','27.F1','10','10','5','1','U1','27','',''); set role service_role`);
  const badIdentityMaximum = await call(['maximum',null,null,'U9','ptravailable',true,null,'U1',null,100,'[]']);
  assert.equal(badIdentityMaximum.complete,false,'a potentially eligible row without item identity prevents a false maximum');
  assert.equal(badIdentityMaximum.winner,null);

  const openCount = await call(['count','3DP','#3',null,'ptravailable',true,null,'F1',null,100,'[]']);
  assert.equal(openCount.total,475);
  assert.equal(openCount.complete,true);

  const lots1 = await call(['lots','3DP','#3',null,'ptravailable',true,90,'F1',null,1,'[]']);
  assert.equal(lots1.rows.length,1);
  assert.equal(lots1.rows[0].unique_id,'u2');
  assert.equal(lots1.hasMore,true);
  const lots2 = await call(['lots','3DP','#3',null,'ptravailable',true,90,'F1',JSON.stringify(lots1.nextCursor),1,'[]']);
  assert.equal(lots2.rows[0].unique_id,'u1');
  assert.equal(lots2.complete,true,'missing priority sorts last without making available stock incomplete');
  const lots3 = await call(['lots','3DP','#3',null,'ptravailable',true,90,'F1',JSON.stringify(lots2.nextCursor),1,'[]']);
  assert.equal(lots3.rows[0].unique_id,'u5');
  assert.equal(lots3.complete,true);
  assert.equal(Object.hasOwn(lots3.rows[0], 'cumulativeQty'),false,'eligible lots are not presented as a split-order total');
  const missingAvailableLots = await call(['lots','10DP','#1',null,'ptravailable',false,1,'F1',null,100,'[]']);
  assert.equal(missingAvailableLots.complete,false,'an unknown available quantity may be an eligible lot');
  const incompleteUnknown = await call(['count','8DP','#1',null,'ptravailable',false,null,'F1',null,100,'[]']);
  assert.equal(incompleteUnknown.complete,false,'unknown quantity in an eligible row must not be represented as zero');
  assert.equal(incompleteUnknown.total,null);
  const emptyCount = await call(['count','NO-SUCH-SKU',null,null,'ptravailable',false,null,'F1',null,100,'[]']);
  assert.equal(emptyCount.complete,true);
  assert.equal(emptyCount.total,0);
  assert.deepEqual(emptyCount.rows,[]);
  const unknownMaximum = await call(['maximum',null,'#1','U1','ptravailable',true,null,'F1',null,100,'[]']);
  assert.equal(unknownMaximum.complete,false);
  assert.equal(unknownMaximum.winner,null,'incomplete candidate values must never produce a confident winner');
  const unknownYearMaximum = await call(['maximum',null,'#1','U9','ptravailable',true,null,'F1',null,100,'[]']);
  assert.equal(unknownYearMaximum.complete,false,'unknown required sales years remain possibly eligible');
  assert.equal(unknownYearMaximum.winner,null);
  const tieMaximum = await call(['maximum',null,'#1','U1','ptravailable',false,null,'U3',null,100,'[]']);
  assert.equal(tieMaximum.complete,true);
  assert.equal(tieMaximum.tieCount,2);
  assert.equal(tieMaximum.winner.itemcode,'TIEA','ties choose a stable lexical identity');
  const futureOpenCount = await call(['count','3DP','#3',null,'ptravailable',true,null,'F1',null,100,'[]']);
  assert.equal(futureOpenCount.complete,true,'future rows with unknown quantity/open stock do not poison current totals');

  const validDraft = await call(['validate_draft',null,null,null,'ptravailable',false,null,'F1',null,100,
    JSON.stringify([{unique_id:'alias',itemcode:'3DP',commonname:'Little Hotties Alias',contsize:'#3',locationcode:'',lotcode:'',quantity:5}])]);
  assert.equal(validDraft.valid,true);
  assert.equal(validDraft.rows[0].quantity,5);
  const invalidDraft = await call(['validate_draft',null,null,null,'ptravailable',false,null,'F1',null,100,
    JSON.stringify([{unique_id:'alias',itemcode:'3DP',commonname:'Wrong plant',contsize:'#3',locationcode:'',lotcode:'',quantity:5}])]);
  assert.equal(invalidDraft.valid,false);
  assert.equal(invalidDraft.rows.length,0);
  assert.equal(invalidDraft.failures[0].error,'row_changed_or_out_of_scope');
  const duplicateDraft = await call(['validate_draft',null,null,null,'ptravailable',false,null,'F1',null,100,
    JSON.stringify([
      {unique_id:'alias',itemcode:'3DP',commonname:'Little Hotties Alias',contsize:'#3',locationcode:'',lotcode:'',quantity:1},
      {unique_id:'alias',itemcode:'3DP',commonname:'Little Hotties Alias',contsize:'#3',locationcode:'',lotcode:'',quantity:1},
    ])]);
  assert.equal(duplicateDraft.valid,false);
  assert.equal(duplicateDraft.failures.length,2,'duplicate row identities are rejected per line');
  const duplicateSkuDraft = await call(['validate_draft',null,null,null,'ptravailable',false,null,'F1',null,100,
    JSON.stringify([
      {unique_id:'u1',itemcode:'3DP',commonname:'Little Hotties',contsize:'#3',locationcode:'U1',lotcode:'26.F1',quantity:1},
      {unique_id:'u2',itemcode:'3DP',commonname:'Little Hotties',contsize:'#3',locationcode:'U2',lotcode:'26.F1',quantity:1},
    ])]);
  assert.equal(duplicateSkuDraft.valid,false);
  assert.ok(duplicateSkuDraft.failures.every(line => line.error === 'duplicate_sku'));
  await assert.rejects(() => call(['validate_draft',null,null,null,'ptravailable',false,null,'F1',null,100,
    JSON.stringify(Array.from({length:51},(_,i)=>({unique_id:`u${i}`,itemcode:'3DP',commonname:'x',contsize:'#3',locationcode:'U1',lotcode:'x',quantity:1})))]), /AURA_V2_DRAFT_INVALID/);
  await assert.rejects(() => call(['lots','3DP','#3',null,'ptravailable',false,1.5,'F1',null,10,'[]']), /AURA_V2_QUANTITY_INVALID/);
  await assert.rejects(() => call(['maximum',null,null,null,'ptravailable',false,null,'F2',null,10,'[]']), /AURA_V2_SEASON_INVALID/);

  await db.exec(`reset role; insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptravailable,ptronhand,s_lts,priority,season,saleyear,desigitem,app_tab_assignment)
    select 'catalog-cap-'||n,'CAP'||lpad(n::text,5,'0'),'Catalog '||n,'#1','U1','26.F1','1','1','1','1','F1','27','',''
    from generate_series(1,10005) n; set role service_role`);
  const cappedCatalog = await call(['catalog',null,null,null,'ptravailable',false,null,null,null,500,'[]']);
  assert.equal(cappedCatalog.complete,false,'catalogs over 10,000 distinct identities must be marked incomplete');
  assert.equal(cappedCatalog.rows.length,500);
  assert.equal(cappedCatalog.hasMore,true);

  await db.exec('set enable_seqscan = off');
  const seasonSizePlan = (await query(`explain select unique_id from public.ph_master_inventory
    where upper(btrim(coalesce(season,'')))='U3'
      and public.aura_inventory_v2_size_v1(contsize)='3dp'`))
    .map(row => row['QUERY PLAN']).join('\n');
  assert.match(seasonSizePlan, /idx_ph_master_inventory_aura_season_size/,
    'the exact COALESCE season and canonical size expressions can use the scope index');
  const exactNamePlan = (await query(`explain select unique_id from public.ph_master_inventory
    where public.aura_inventory_v2_name_v1(commonname)='baby gem boxwood'`))
    .map(row => row['QUERY PLAN']).join('\n');
  assert.match(exactNamePlan, /idx_ph_master_inventory_aura_name_exact/,
    'normalized exact-name equality can use the B-tree index');
  await db.exec('set search_path = public, extensions');
  const trigramPlan = (await query(`explain select unique_id from public.ph_master_inventory
    where public.aura_inventory_v2_name_v1(commonname) %> 'oak'::text`))
    .map(row => row['QUERY PLAN']).join('\n');
  assert.match(trigramPlan, /idx_ph_master_inventory_aura_name_trgm/,
    'word-similarity matching can use the trigram GIN index');
  await db.exec('reset enable_seqscan; reset search_path');

  await db.exec('reset role; set role anon');
  await assert.rejects(() => query(`select public.aura_inventory_v2_read_v1('catalog')`), /permission denied/);
  console.log('AURA V2 SQL passed: all-season catalog, explicit U2 reads, location-aware SKU/size aggregates, bounded numeric-priority lots, unknown-value completeness, draft identity/quantity validation, 50-line cap, role boundary.');
} finally { await db.close(); }
