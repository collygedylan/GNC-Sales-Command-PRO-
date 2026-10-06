import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { createDatabaseClientOptions, validateDatabaseTarget } from './apply-item-low-stock-migration.mjs';

export const perennialPreviewSql = `
with classified as materialized (
  select unique_id, upper(btrim(itemcode)) itemcode,
    upper(btrim(coalesce(plantgroupcode,''))) plantgroup,
    private.eval_location_zone(locationcode) zone_state
  from public.ph_master_inventory
), active_owners as (
  select distinct lower(btrim(u.username)) username from public.ph_eval_assignment_users u
  left join public.profiles p on lower(btrim(p.username))=lower(btrim(u.username))
  where u.active and p.disabled_at is null and (p.locked_until is null or p.locked_until<=now())
), saved as (
  select upper(btrim(coalesce(a.itemcode_normalized,a.itemcode,''))) itemcode,
    case when a.zone_override_active then nullif(lower(btrim(a.zone_override_prior_assignedto)),'')
      else nullif(lower(btrim(a.assignedto)),'') end saved_owner
  from public.ph_warehouse_assigned_items a where a.present_in_drive and a.assignment_key is not null
), candidates as (
  select s.itemcode, o.username owner from saved s left join active_owners o on o.username=s.saved_owner
), defaults as (
  select itemcode, min(owner) owner,
    count(distinct owner)>1 or (count(owner)>0 and count(owner)<count(*)) conflict
  from candidates where itemcode<>''
    and itemcode in (select c.itemcode from classified c) group by itemcode
), source_state as (
  select revision,state from public.app_dataset_revisions where key='ph_master_inventory'
)
select r.revision inventory_revision, r.state inventory_state,
  r.state='ready' and not exists(select 1 from app_sync_private.import_leases where key='ph_master_inventory') preview_ready,
  (select count(*) from classified)::integer inventory_rows,
  (select count(*) from classified where zone_state='inside' and plantgroup<>'135_ROSES')::integer in_zone_policy_groups,
  (select count(*) from classified where zone_state='inside' and plantgroup='135_ROSES')::integer rose_override_rows,
  (select count(*) from classified where zone_state='outside')::integer outside_rows,
  (select count(*) from classified where zone_state is null)::integer unresolved_rows,
  (select count(*) from defaults where owner is not null and not conflict)::integer consistent_active_defaults,
  (select count(*) from defaults where owner is null)::integer unassigned_defaults,
  (select count(*) from defaults where conflict)::integer conflicting_defaults,
  (select count(*) from active_owners where username='zoe_green')::integer zoe_active_roster_rows,
  (select count(*) from active_owners where username='mitch_kaiser')::integer mitch_active_roster_rows,
  '[]'::jsonb affected_assignments
from source_state r`;

export function getPerennialPreviewFailure(preview) {
  if (!preview || preview.previewReady !== true || preview.inventoryState !== 'ready') {
    return 'PERENNIAL_PREVIEW_MASTER_NOT_READY';
  }
  const inZoneGroups = Number(preview.counts?.in_zone_policy_groups);
  const activeZoeRows = Number(preview.counts?.zoe_active_roster_rows);
  if (!Number.isSafeInteger(inZoneGroups) || inZoneGroups < 0 || !Number.isSafeInteger(activeZoeRows) || activeZoeRows < 0) {
    return 'PERENNIAL_PREVIEW_RESULT_INVALID';
  }
  if (inZoneGroups > 0 && activeZoeRows < 1) return 'PERENNIAL_PREVIEW_ZOE_INACTIVE';
  const roseRows = Number(preview.counts?.rose_override_rows);
  const activeMitchRows = Number(preview.counts?.mitch_active_roster_rows);
  const conflicts = Number(preview.counts?.conflicting_defaults);
  if (![roseRows, activeMitchRows, conflicts].every(value => Number.isSafeInteger(value) && value >= 0)) return 'PERENNIAL_PREVIEW_RESULT_INVALID';
  if (roseRows > 0 && activeMitchRows < 1) return 'PERENNIAL_PREVIEW_MITCH_INACTIVE';
  if (conflicts > 0) return 'PERENNIAL_PREVIEW_DEFAULT_CONFLICT';
  return '';
}

export async function runPerennialAssignmentPreview({client,repositorySha,generatedAt=new Date().toISOString()}) {
  let transactionOpen=false;
  try {
    await client.query('begin read only');
    transactionOpen=true;
    const result=await client.query(perennialPreviewSql);
    const row=result.rows?.[0];
    if (!row) throw new Error('PERENNIAL_PREVIEW_RESULT_MISSING');
    return {
      contractVersion:'inventory-row-assignment-preview-v1',
      repositorySha,
      generatedAt,
      previewMode:'read_only_aggregate',
      previewReady:row.preview_ready===true,
      policyActivation:'requires_complete_snapshot_and_verified_backfill',
      counts:Object.fromEntries(Object.entries(row).filter(([key])=>!['affected_assignments','preview_ready','inventory_state'].includes(key))
        .map(([key,value])=>[key,value==null?null:Number.isSafeInteger(Number(value))?Number(value):value])),
      inventoryState:row.inventory_state,
      affectedAssignments:row.preview_ready===true?(row.affected_assignments||[]):[]
    };
  } finally {
    if (transactionOpen) await client.query('rollback');
  }
}

async function main() {
  const env=process.env;
  if (env.GITHUB_ACTIONS!=='true'||env.GITHUB_REF!=='refs/heads/main'||!['push','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)
      ||!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY||'')||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')||!env.GH_TOKEN) {
    throw new Error('PERENNIAL_PREVIEW_RELEASE_CONTEXT_INVALID');
  }
  const response=await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/git/ref/heads/main`,{
    headers:{authorization:`Bearer ${env.GH_TOKEN}`,accept:'application/vnd.github+json'},signal:AbortSignal.timeout(15000)
  });
  if (!response.ok||(await response.json()).object?.sha!==env.GITHUB_SHA) throw new Error('PERENNIAL_PREVIEW_REQUIRES_CURRENT_MAIN');
  const connectionString=validateDatabaseTarget(env.SUPABASE_DB_URL,env.SUPABASE_URL);
  const client=new pg.Client(createDatabaseClientOptions(connectionString));
  try {
    await client.connect();
    const preview=await runPerennialAssignmentPreview({client,repositorySha:env.GITHUB_SHA});
    const output=path.resolve('.gnc-local/perennial-assignment-preview.json');
    fs.mkdirSync(path.dirname(output),{recursive:true});
    fs.writeFileSync(output,`${JSON.stringify(preview,null,2)}\n`);
    console.log(`PERENNIAL_ASSIGNMENT_PREVIEW ready=${preview.previewReady} state=${preview.inventoryState} counts=${JSON.stringify(preview.counts)}`);
    const previewFailure=getPerennialPreviewFailure(preview);
    if(previewFailure) throw new Error(previewFailure);
  } finally { await client.end(); }
}

if (process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error=>{const message=error?.message;
    console.error(message==='PERENNIAL_PREVIEW_REQUIRES_CURRENT_MAIN'||/^PERENNIAL_PREVIEW_(?:MASTER_NOT_READY|ZOE_INACTIVE|MITCH_INACTIVE|DEFAULT_CONFLICT|RESULT_INVALID)$/.test(message||'')
      ?message:'PERENNIAL_ASSIGNMENT_PREVIEW_FAILED');process.exitCode=1;});
}
