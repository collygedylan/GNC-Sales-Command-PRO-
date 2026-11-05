import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';
import { to as copyTo, from as copyFrom } from 'pg-copy-streams';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidence = process.env.AGDATA_TEST_EVIDENCE || 'G:/My Drive/GNC/AgData/Release Evidence';
const schemas = ['public', 'private', 'bloomscapes_private', 'hl_order_private', 'sales_private', 'aura_private', 'labor_internal', 'import_private', 'suspend_tag_private', 'app_sync_private', 'bunch_note_private', 'workflow_private'];
const q = s => '"' + String(s).replaceAll('"', '""') + '"';
const literal = s => "'" + String(s).replaceAll("'", "''") + "'";
const short = s => s.length <= 63 ? s : s.slice(0, 50) + '_' + crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const targetSchema = s => s === 'public' ? s : 'test_' + s;
const targetName = (s, n) => s === 'public' ? short('test_' + n) : n;
const qualify = (s, n) => q(s) + '.' + q(n);
const target = r => qualify(targetSchema(r.schema), targetName(r.schema, r.name));
const reportPath = path.join(evidence, 'agdata-test-clone-progress.json');
const snapshotPath = path.join(evidence, 'agdata-test-clone-catalog.json');
let state = await fs.readFile(reportPath, 'utf8').then(JSON.parse).catch(() => ({ version: 1, tables: {}, stages: {}, failures: [] }));
const save = async () => fs.writeFile(reportPath, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2) + '\n');
const env = await fs.readFile(path.join(root, '.env'), 'utf8');
const url = env.split(/\r?\n/).find(l => l.startsWith('GNC_SUPABASE_DB_URL='))?.slice(20).trim().replace(/^['"]|['"]$/g, '');
if (!url || !decodeURIComponent(new URL(url).username).includes('kzrnyjsosryejjejliii')) throw Error('SOURCE_PROJECT_MISMATCH');
const targetConfig = JSON.parse(await fs.readFile(path.join(root, '.gnc-local/test-clone-credentials.json'), 'utf8'));
if (!targetConfig.user.includes('apztnscvagayslumnalr') && !targetConfig.host.includes('apztnscvagayslumnalr')) throw Error('TARGET_PROJECT_MISMATCH');
const source = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, application_name: 'agdata_test_readonly_clone', statement_timeout: 120000 });
const dest = new pg.Client({ ...targetConfig, statement_timeout: 120000 });
await source.connect(); await dest.connect();
await source.query("SET default_transaction_read_only=on; SET timezone='UTC'; SET datestyle='ISO, YMD'");
await dest.query("SET check_function_bodies=off; SET search_path=public,extensions; SET lock_timeout='5s'; SET timezone='UTC'; SET datestyle='ISO, YMD'");
await dest.query("SELECT extensions.word_similarity('a','a')");
let catalog;
async function inventory() {
  const rows = async sql => (await source.query(sql, [schemas])).rows;
  const relations = await rows(`SELECT c.oid,n.nspname AS schema,c.relname AS name,c.relkind AS kind,c.relispartition,pg_get_expr(c.relpartbound,c.oid) AS bound,pg_get_partkeydef(c.oid) AS partkey,(SELECT inhparent FROM pg_inherits WHERE inhrelid=c.oid LIMIT 1) AS parent_oid,c.relrowsecurity AS rls,pg_relation_size(c.oid)::bigint AS heap_bytes,pg_total_relation_size(c.oid)::bigint AS bytes,c.reltuples::bigint AS estimated_rows FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) AND c.relkind IN ('r','p','v','m','S') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.deptype='e') ORDER BY n.nspname,c.relname`);
  const columns = await rows(`SELECT a.attrelid,a.attname,a.attnum,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) AS default_expr FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname=ANY($1) AND a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m','c') ORDER BY a.attrelid,a.attnum`);
  const functions = await rows(`SELECT n.nspname AS schema,p.proname AS name,p.oid,pg_get_function_identity_arguments(p.oid) AS args,pg_get_functiondef(p.oid) AS definition,p.prorettype::regtype::text AS result,p.prokind FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1) AND p.prokind IN ('f','p') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e') ORDER BY n.nspname,p.proname`);
  const constraints = await rows(`SELECT c.oid,c.conrelid,c.conname,c.contype,c.conparentid,pg_get_constraintdef(c.oid,true) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname=ANY($1) ORDER BY CASE c.contype WHEN 'p' THEN 1 WHEN 'u' THEN 2 WHEN 'c' THEN 3 ELSE 4 END,c.oid`);
  const indexes = await rows(`SELECT i.indexrelid,i.indrelid,c.relname AS name,pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) AND NOT EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conindid=i.indexrelid)`);
  const triggers = await rows(`SELECT t.oid,t.tgrelid,t.tgname,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) AND NOT t.tgisinternal AND t.tgparentid=0`);
  const policies = await rows(`SELECT c.oid AS table_oid,p.* FROM pg_policies p JOIN pg_namespace n ON n.nspname=p.schemaname JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=p.tablename WHERE p.schemaname=ANY($1)`);
  const grants = await rows(`SELECT table_schema,table_name,grantee,privilege_type FROM information_schema.role_table_grants WHERE table_schema=ANY($1) AND grantee IN ('anon','authenticated','service_role')`);
  const functionGrants = await rows(`SELECT p.oid,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE r.rolname END AS grantee,a.privilege_type FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname=ANY($1) AND (a.grantee=0 OR r.rolname IN ('anon','authenticated','service_role'))`);
  const sequences = await rows(`SELECT n.nspname AS schema,c.relname AS name,s.seqstart,s.seqincrement,s.seqmin,s.seqmax,s.seqcache,s.seqcycle,format_type(s.seqtypid,NULL) AS type FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1)`);
  const views = await rows(`SELECT c.oid,n.nspname AS schema,c.relname AS name,pg_get_viewdef(c.oid,true) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) AND c.relkind IN ('v','m')`);
  const types = await rows(`SELECT n.nspname AS schema,t.typname,t.typtype FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=ANY($1) AND t.typtype IN ('e','d','r') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=t.oid AND d.deptype='e')`);
  if (types.length) throw Error('UNREVIEWED_CUSTOM_TYPES');
  return { relations, columns, functions, constraints, indexes, triggers, policies, grants, functionGrants, sequences, views, capturedAt: new Date().toISOString() };
}
catalog = await fs.readFile(snapshotPath, 'utf8').then(JSON.parse).catch(inventory);
await fs.writeFile(snapshotPath, JSON.stringify(catalog));
const byOid = new Map(catalog.relations.map(r => [r.oid, r]));
const publicNames = new Map([...catalog.relations, ...catalog.functions].filter(r => r.schema === 'public').map(r => [r.name, targetName(r.schema, r.name)]));
const allNames = new Map(publicNames);
for (const r of catalog.indexes) { const parent = byOid.get(r.indrelid); if (parent?.schema === 'public') allNames.set(r.name, short('test_' + r.name)); }
const rxEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const objectNamePattern = [...allNames.keys()].sort((a,b)=>b.length-a.length).map(rxEscape).join('|');
const publicQualifiedRx = new RegExp('\\bpublic\\.("?)(' + objectNamePattern + ')\\1\\b', 'g');
const quotedObjectRx = new RegExp("'(" + objectNamePattern + ")'", 'g');
const publicFunctions = new Set(catalog.functions.filter(f=>f.schema==='public').map(f=>f.name));
const functionCallRx = new RegExp('(?<![\\w.])(' + [...publicFunctions].map(rxEscape).join('|') + ')(?=\\s*\\()', 'g');
const relationContextRx = new RegExp('\\b(FROM|JOIN|UPDATE|INTO|TABLE|REFERENCES|SEQUENCE|VIEW|ON)\\s+(ONLY\\s+)?("?)(' + objectNamePattern + ')\\3\\b', 'gi');
const schemaRx = new RegExp('\\b(' + schemas.filter(s => s !== 'public').sort((a,b)=>b.length-a.length).join('|') + ')\\b', 'g');
const tableQualifierRx = new RegExp('(?<![\\w.])(' + [...publicNames.keys()].map(rxEscape).join('|') + ')(?=\\.)', 'g');
const rewrite = sql => sql.replace(publicQualifiedRx, (_m,quote,n)=>'public.'+quote+allNames.get(n)+quote)
 .replace(quotedObjectRx,(_m,n)=>literal(allNames.get(n)))
 .replace(functionCallRx,n=>allNames.get(n))
 .replace(tableQualifierRx,n=>allNames.get(n))
 .replace(relationContextRx,(m,kw,only,quote,n)=>allNames.has(n)?kw+' '+(only||'')+quote+allNames.get(n)+quote:m)
 .replace(schemaRx,s=>targetSchema(s)).replaceAll('kzrnyjsosryejjejliii','apztnscvagayslumnalr').replace(/'ph_%'/g,"'test_ph_%'");
const steps = [];
const rewriteTypes = sql => { let result=rewrite(sql); for(const r of catalog.relations.filter(r=>r.schema==='public'&&['r','p','v'].includes(r.kind))) { const name=rxEscape(r.name); result=result.replace(new RegExp('(?<![\\w.])'+name+'(?=\\s*(?:[%\\[;,)\\]]|$))','g'),targetName(r.schema,r.name)).replace(new RegExp('(RETURNS\\s+(?:SETOF\\s+)?)'+name+'\\b','gi'),(_m,prefix)=>prefix+targetName(r.schema,r.name)); } return result; };

const run = async (sql, retain = true) => { try { await dest.query(sql); } catch(e) { await fs.writeFile(path.join(evidence,'agdata-test-clone-failed.sql'),sql); e.message += ' AT ' + sql.slice(Math.max(0,Number(e.position||1)-80),Number(e.position||1)+120).replace(/\s+/g,' '); throw e; } if (retain) steps.push(sql.replace(/;\s*$/, '') + ';'); };
async function schemaStage() {
  if (state.stages.schema) return;
  for (const s of schemas.filter(s => s !== 'public')) await run(`CREATE SCHEMA IF NOT EXISTS ${q(targetSchema(s))}`);
  for (const s of catalog.sequences) await run(`CREATE SEQUENCE IF NOT EXISTS ${qualify(targetSchema(s.schema),targetName(s.schema,s.name))} AS ${s.type} INCREMENT ${s.seqincrement} MINVALUE ${s.seqmin} MAXVALUE ${s.seqmax} START ${s.seqstart} CACHE ${s.seqcache} ${s.seqcycle?'CYCLE':'NO CYCLE'}`);
  if(!state.stages.bootstrap) for(const f of catalog.functions.filter(f=>!/net\.http|http_post\(|http_get\(|dblink|script\.google|onesignal|api\.github\.com/i.test(f.definition))){try{await dest.query(rewriteTypes(f.definition));await dest.query(`REVOKE ALL ON FUNCTION ${qualify(targetSchema(f.schema),targetName(f.schema,f.name))}(${rewriteTypes(f.args)}) FROM PUBLIC, anon, authenticated`);}catch{ /* Composite types are installed with their tables below. */ }}
  state.stages.bootstrap=true;await save();
  const tables = catalog.relations.filter(r => ['r','p'].includes(r.kind));
  const ordered = [...tables.filter(r => !r.parent_oid), ...tables.filter(r => r.parent_oid)];
  if(!state.stages.tables) for (const r of ordered) {
    const columns = catalog.columns.filter(c => c.attrelid === r.oid);
    if (r.relispartition) {
      await run(`CREATE TABLE IF NOT EXISTS ${target(r)} PARTITION OF ${target(byOid.get(r.parent_oid))} ${rewrite(r.bound)}`);
    } else {
      const definition = columns.map(c => `${q(c.attname)} ${rewrite(c.type)}${c.attgenerated ? ' GENERATED ALWAYS AS ('+rewrite(c.default_expr)+') STORED' : ''}${c.attnotnull?' NOT NULL':''}`).join(',\n');
      await run(`CREATE TABLE IF NOT EXISTS ${target(r)} (${definition})${r.partkey?' PARTITION BY '+rewrite(r.partkey):''}`);
    }
    await run(`ALTER TABLE ${target(r)} ENABLE ROW LEVEL SECURITY`);
    await run(`REVOKE ALL ON ${target(r)} FROM PUBLIC, anon, authenticated`);
  }
  state.stages.tables=true;await save();
  const isolated = [];
  for (const f of catalog.functions) {
    if(state.installedFunctions?.includes(f.oid))continue;
    let sql = rewriteTypes(f.definition);
    if (/net\.http|http_post\(|http_get\(|dblink|script\.google|onesignal|api\.github\.com/i.test(f.definition)) {
      isolated.push(f.schema+'.'+f.name);
      const value = f.result === 'trigger' ? 'RETURN COALESCE(NEW, OLD);' : f.result === 'void' ? 'RETURN;' : f.result === 'jsonb' ? `RETURN '{"ok":false,"code":"TEST_EXTERNAL_DISPATCH_DISABLED"}'::jsonb;` : 'RETURN NULL;';
      sql = `CREATE OR REPLACE FUNCTION ${qualify(targetSchema(f.schema),targetName(f.schema,f.name))}(${rewriteTypes(f.args)}) RETURNS ${rewrite(f.result)} LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $test_isolated$ BEGIN ${value} END $test_isolated$`;
    }
    try { await run(sql); } catch (e) { state.failures.push({ stage:'function', name:f.schema+'.'+f.name, code:e.code, message:e.message }); throw e; }
    await run(`REVOKE ALL ON FUNCTION ${qualify(targetSchema(f.schema),targetName(f.schema,f.name))}(${rewriteTypes(f.args)}) FROM PUBLIC, anon, authenticated`);
    (state.installedFunctions??=[]).push(f.oid);if(state.installedFunctions.length%50===0)await save();
  }
  if(!state.stages.defaults) { for (const r of ordered.filter(r=>!r.relispartition)) for (const c of catalog.columns.filter(c=>c.attrelid===r.oid && c.default_expr && !c.attgenerated)) await run(`ALTER TABLE ${target(r)} ALTER COLUMN ${q(c.attname)} SET DEFAULT ${rewrite(c.default_expr)}`);state.stages.defaults=true;await save(); }
  let pending = [...catalog.views];
  while (pending.length) {
    const failed = [];
    for (const v of pending) { try { await run(`CREATE OR REPLACE VIEW ${target(v)} WITH (security_invoker=true) AS ${rewriteTypes(v.definition)}`); } catch(e) { failed.push({...v,error:e.message}); } }
    if (failed.length===pending.length) throw Error('VIEW_DEPENDENCY_UNRESOLVED '+failed.map(v=>v.schema+'.'+v.name+':'+v.error).slice(0,3).join(';'));
    pending=failed;
  }
  await fs.mkdir(path.join(root,'test/database'),{recursive:true});
  await fs.writeFile(path.join(root,'test/database/namespace-map.json'),JSON.stringify({project:'apztnscvagayslumnalr',sourceCommit:'bbec1af47fb5f07643ae5d7a83d91d760d0868f9',tables:Object.fromEntries(publicNames),schemas:Object.fromEntries(schemas.map(s=>[s,targetSchema(s)])),isolatedExternalFunctions:isolated},null,2)+'\n');
  await fs.writeFile(path.join(evidence,'agdata-test-clone-schema.sql'),steps.join('\n')+'\n');
  state.stages.schema=true; state.isolatedExternalFunctions=isolated; await save();
}
async function dataStage() {
  if (!state.stages.schema) throw Error('SCHEMA_REQUIRED');
  await dest.query('CREATE TABLE IF NOT EXISTS test_private.clone_copy_progress (source_table text PRIMARY KEY, receipt jsonb NOT NULL)');
  const priority=['ph_app_users','user_access','profiles','ph_master_inventory','ph_soc_master','ph_reserves','ph_requests_pending','ph_itemcode_default_owners','ph_location_sales_notes','ph_eval_work'];
  const tables=catalog.relations.filter(r=>r.kind==='r').sort((a,b)=>{const ai=priority.indexOf(a.name),bi=priority.indexOf(b.name);return (ai<0?999:ai)-(bi<0?999:bi)||Number(a.bytes)-Number(b.bytes);});
  for(const r of tables){
    const key=r.schema+'.'+r.name;
    let progress=(await dest.query('SELECT receipt FROM test_private.clone_copy_progress WHERE source_table=$1',[key])).rows[0]?.receipt;
    if(progress?.complete||state.tables[key]?.complete){if(progress)state.tables[key]=progress;continue;}
    const fields=catalog.columns.filter(c=>c.attrelid===r.oid&&!c.attgenerated).map(c=>q(c.attname)).join(',');
    const blocks=Math.ceil(Number((await source.query('SELECT pg_relation_size($1::regclass) AS bytes',[qualify(r.schema,r.name)])).rows[0].bytes)/8192);
    const chunkBlocks=2048;
    if(!progress){progress={complete:false,nextBlock:0,blocks,rows:0,bytes:0,chunks:[],target:target(r),startedAt:new Date().toISOString()};await dest.query('BEGIN');try{await dest.query('TRUNCATE ONLY '+target(r));await dest.query('INSERT INTO test_private.clone_copy_progress VALUES($1,$2)',[key,JSON.stringify(progress)]);await dest.query('COMMIT');}catch(e){await dest.query('ROLLBACK');throw e;}}
    do {
      const begin=progress.nextBlock,end=Math.min(begin+chunkBlocks,Math.max(blocks,1));
      const hash=crypto.createHash('sha256');let bytes=0,rows=0;const start=Date.now();
      await dest.query('BEGIN');
      try{
        const output=source.query(copyTo('COPY (SELECT '+fields+' FROM ONLY '+qualify(r.schema,r.name)+" WHERE ctid >= '("+begin+",0)'::tid AND ctid < '("+end+",0)'::tid) TO STDOUT WITH (FORMAT text)"));
        const input=dest.query(copyFrom('COPY '+target(r)+' ('+fields+') FROM STDIN WITH (FORMAT text)'));
        const meter=new Transform({transform(chunk,encoding,done){bytes+=chunk.length;hash.update(chunk);for(const b of chunk)if(b===10)rows++;done(null,chunk);}});
        await pipeline(output,meter,input);
        if(input.rowCount!==undefined&&Number(input.rowCount)!==rows)throw Error('COPY_RECEIPT_ROW_COUNT_MISMATCH');
        progress={...progress,nextBlock:end,complete:end>=blocks,rows:progress.rows+rows,bytes:progress.bytes+bytes,chunks:[...progress.chunks,{begin,end,rows,sha256:hash.digest('hex'),elapsedMs:Date.now()-start}]};
        await dest.query('UPDATE test_private.clone_copy_progress SET receipt=$2 WHERE source_table=$1',[key,JSON.stringify(progress)]);
        await dest.query('COMMIT');state.tables[key]=progress;await save();
      }catch(e){await dest.query('ROLLBACK').catch(()=>{});state.failures.push({stage:'data',table:key,code:e.code,message:e.message});await save();throw e;}
    }while(!progress.complete);
  }
  state.stages.data=true;await save();
}
async function finishStage() {
  if(!state.stages.data)throw Error('DATA_REQUIRED');if(state.stages.finish)return;
  const existingConstraints=new Set((await dest.query("SELECT n.nspname||'.'||r.relname||'.'||c.conname AS key FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname LIKE 'test_%' OR (n.nspname='public' AND r.relname LIKE 'test_%')")).rows.map(r=>r.key));
  const batch=async statements=>{for(let i=0;i<statements.length;i+=25)await run(statements.slice(i,i+25).map(s=>s.replace(/;\s*$/,'')+';').join('\n'));};
  const constraints=[];
  for(const c of catalog.constraints.filter(c=>!c.conparentid&&c.contype!=='t')){const r=byOid.get(c.conrelid);if(!r)continue;const name=r.schema==='public'?short('test_'+c.conname):c.conname;if(existingConstraints.has(targetSchema(r.schema)+'.'+targetName(r.schema,r.name)+'.'+name))continue;constraints.push('ALTER TABLE '+target(r)+' ADD CONSTRAINT '+q(name)+' '+rewrite(c.definition));}
  await batch(constraints);state.stages.constraints=true;await save();
  const existingIndexes=new Set((await dest.query("SELECT n.nspname||'.'||c.relname AS key FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN('i','I') AND (n.nspname LIKE 'test_%' OR n.nspname='public')")).rows.map(r=>r.key));
  const indexes=[];for(const i of catalog.indexes){const r=byOid.get(i.indrelid);if(r?.relispartition)continue;const name=r?.schema==='public'?short('test_'+i.name):i.name;if(existingIndexes.has(targetSchema(r.schema)+'.'+name))continue;indexes.push(rewrite(i.definition).replace(/^(CREATE (?:UNIQUE )?INDEX )([^ ]+)/,(_m,prefix)=>prefix+'IF NOT EXISTS '+q(name)));}await batch(indexes);state.stages.indexes=true;await save();
  const existingTriggers=new Set((await dest.query("SELECT n.nspname||'.'||c.relname||'.'||t.tgname AS key FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal")).rows.map(r=>r.key));
  for(const t of catalog.triggers){const r=byOid.get(t.tgrelid),key=targetSchema(r.schema)+'.'+targetName(r.schema,r.name)+'.'+t.tgname;if(existingTriggers.has(key))continue;if((await dest.query('SELECT 1 FROM pg_trigger WHERE tgrelid=$1::regclass AND tgname=$2',[target(r),t.tgname])).rowCount)continue;await run(rewrite(t.definition));}const triggerModes=[];for(const t of catalog.triggers){if(t.tgenabled&&t.tgenabled!=='O'){const r=byOid.get(t.tgrelid),verb=t.tgenabled==='D'?'DISABLE':t.tgenabled==='A'?'ENABLE ALWAYS':'ENABLE REPLICA';triggerModes.push('ALTER TABLE '+target(r)+' '+verb+' TRIGGER '+q(t.tgname));}}await batch(triggerModes);state.stages.triggers=true;await save();
  const policies=new Set((await dest.query("SELECT schemaname||'.'||tablename||'.'||policyname AS key FROM pg_policies")).rows.map(r=>r.key));const policySql=[];
  for(const p of catalog.policies){const r=byOid.get(p.table_oid),key=targetSchema(r.schema)+'.'+targetName(r.schema,r.name)+'.'+p.policyname;if(policies.has(key))continue;const roles=Array.isArray(p.roles)?p.roles:String(p.roles).replace(/[{}]/g,'').split(',');policySql.push('CREATE POLICY '+q(p.policyname)+' ON '+target(r)+' AS '+p.permissive+' FOR '+p.cmd+' TO '+roles.map(r=>r==='public'?'PUBLIC':q(r)).join(',')+(p.qual?' USING ('+rewrite(p.qual)+')':'')+(p.with_check?' WITH CHECK ('+rewrite(p.with_check)+')':''));}
  for(const r of catalog.relations.filter(r=>['r','p'].includes(r.kind)&&!r.rls)){const key=targetSchema(r.schema)+'.'+targetName(r.schema,r.name)+'.test_preserved_source_read';if(policies.has(key))continue;const readers=[...new Set(catalog.grants.filter(g=>g.table_schema===r.schema&&g.table_name===r.name&&g.privilege_type==='SELECT'&&g.grantee!=='service_role').map(g=>g.grantee))];if(readers.length)policySql.push('CREATE POLICY test_preserved_source_read ON '+target(r)+' FOR SELECT TO '+readers.map(q).join(',')+' USING (true)');}await batch(policySql);state.stages.policies=true;await save();
  const grants=[];
  for(const g of catalog.grants){const r=catalog.relations.find(r=>r.schema===g.table_schema&&r.name===g.table_name);if(r)grants.push('GRANT '+g.privilege_type+' ON '+target(r)+' TO '+q(g.grantee));}
  for(const s of schemas.filter(s=>s!=='public'))grants.push('GRANT USAGE ON SCHEMA '+q(targetSchema(s))+' TO service_role,authenticated,anon');
  for(const f of catalog.functions)for(const grant of catalog.functionGrants.filter(g=>g.oid===f.oid))grants.push('GRANT EXECUTE ON FUNCTION '+qualify(targetSchema(f.schema),targetName(f.schema,f.name))+'('+rewriteTypes(f.args)+') TO '+(grant.grantee==='PUBLIC'?'PUBLIC':q(grant.grantee)));
  for(const name of ['ph_app_users','ph_request_delivery_outbox','ph_request_delivery_worker_state','user_access_control'])if(publicNames.has(name))grants.push('REVOKE ALL ON '+qualify('public',publicNames.get(name))+' FROM anon,authenticated,PUBLIC');
  for(const r of catalog.relations.filter(r=>['r','p'].includes(r.kind)))grants.push('GRANT ALL ON '+target(r)+' TO service_role');await batch(grants);
  for(const s of catalog.sequences){const full=qualify(targetSchema(s.schema),targetName(s.schema,s.name));await run('GRANT USAGE,SELECT ON SEQUENCE '+full+' TO service_role,authenticated');const val=await source.query('SELECT last_value,is_called FROM '+qualify(s.schema,s.name));await dest.query('SELECT setval($1::regclass,$2,$3)',[full,val.rows[0].last_value,val.rows[0].is_called]);}
  state.stages.finish=true;await save();await fs.writeFile(path.join(evidence,'agdata-test-clone-postdata.sql'),steps.join('\n')+'\n');
}

try {
  const stage=process.argv[2]||'all';
  if(stage==='schema'||stage==='all')await schemaStage();
  if(stage==='data'||stage==='all')await dataStage();
  if(stage==='finish'||stage==='all'){await finishStage();for(const file of ['identity-sequences.sql','rebind-metadata.sql'])await dest.query(await fs.readFile(path.join(root,'test/database',file),'utf8'));}
  console.log(JSON.stringify({stage,complete:true,tables:Object.keys(state.tables).length,rows:Object.values(state.tables).reduce((n,t)=>n+t.rows,0)}));
} catch(e) {await save();console.error(JSON.stringify({complete:false,code:e.code||'CLONE_FAILED',message:e.message}));process.exitCode=1;}
finally {await source.end().catch(()=>{});await dest.end().catch(()=>{});}
