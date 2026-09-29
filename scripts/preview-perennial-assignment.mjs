import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { createDatabaseClientOptions, validateDatabaseTarget } from './apply-item-low-stock-migration.mjs';

export const perennialPreviewSql = `
with normalized as materialized (
  select upper(btrim(itemcode)) itemcode,
    lower(regexp_replace(btrim(coalesce(genusname,'')),'[[:space:]]+',' ','g')) genus,
    upper(btrim(coalesce(plantgroupcode,''))) plantgroup,
    upper(regexp_replace(btrim(coalesce(locationcode,'')),'[[:space:]]+','','g')) location
  from public.ph_master_inventory
  where nullif(btrim(coalesce(itemcode,'')),'') is not null
), classified as materialized (
  select itemcode,genus,plantgroup,
    case
      when location !~ '^[A-Z]\\.[0-9]{2}(\\.[0-9]{3})?$' then null
      when location ~ '^C\\.(06|07)(\\.[0-9]{3})?$' then 'inside'
      when location ~ '^D\\.(04|05|06|07|08|09)(\\.[0-9]{3})?$' then 'inside'
      when location ~ '^D\\.10\\.[0-9]{3}$' then case when split_part(location,'.',3)::integer<=21 then 'inside' else 'outside' end
      when location like 'D.10' then null
      else 'outside'
    end zone_state
  from normalized
), groups as (
  select itemcode,genus,coalesce(bool_or(plantgroup='135_ROSES'),false) any_rose,
    coalesce(bool_or(zone_state='inside'),false) any_inside,coalesce(bool_or(zone_state is null),false) any_unresolved,
    coalesce(bool_and(zone_state='outside'),false) all_outside
  from classified group by itemcode,genus
), source_state as materialized (
  select revision::text revision,state from public.app_dataset_revisions where key='ph_master_inventory'
)
select source_state.revision inventory_revision,source_state.state inventory_state,
 source_state.state='ready' preview_ready,
  count(*)::integer itemcode_genus_groups,
  count(*) filter(where any_rose)::integer rose_exempt_groups,
  count(*) filter(where not any_rose and any_inside)::integer in_zone_policy_groups,
  count(*) filter(where not any_rose and not any_inside and any_unresolved)::integer unresolved_groups,
  count(*) filter(where not any_rose and not any_inside and not any_unresolved and all_outside)::integer outside_groups,
  (select count(*)::integer from public.ph_eval_assignment_users where active and lower(btrim(username))='zoe_green') zoe_active_roster_rows,
  (select count(*)::integer from public.ph_warehouse_assigned_items a join groups g on a.assignment_key=g.itemcode||'|'||g.genus
    where not g.any_rose and g.any_inside and a.assignedto is distinct from 'zoe_green') current_owner_changes_estimate
 ,case when source_state.state='ready' then coalesce((
   select jsonb_agg(jsonb_build_object('itemcode',g.itemcode,'genus',g.genus,
     'previousOwner',a.assignedto,'proposedOwner','zoe_green',
     'ownerChange',a.assignedto is distinct from 'zoe_green','automaticAssignment',true,
     'reason',case when coalesce((to_jsonb(a)->>'zone_override_active')::boolean,false)
       then 'reassert_perennial_zone_owner' else 'enforce_perennial_zone_owner' end)
     order by g.itemcode,g.genus)
   from groups g left join public.ph_warehouse_assigned_items a on a.assignment_key=g.itemcode||'|'||g.genus
   where not g.any_rose and g.any_inside
     and (a.assignment_key is null or not coalesce((to_jsonb(a)->>'zone_override_active')::boolean,false)
       or a.assignedto is distinct from 'zoe_green')
 ),'[]'::jsonb) else '[]'::jsonb end affected_assignments
from groups cross join source_state group by source_state.revision,source_state.state`;

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
      contractVersion:'perennial-assignment-preview-v1',
      repositorySha,
      generatedAt,
      previewMode:'read_only_aggregate',
      previewReady:row.preview_ready===true,
      policyActivation:'waits_for_successful_master_import',
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
    console.error(message==='PERENNIAL_PREVIEW_REQUIRES_CURRENT_MAIN'||/^PERENNIAL_PREVIEW_(?:MASTER_NOT_READY|ZOE_INACTIVE|RESULT_INVALID)$/.test(message||'')
      ?message:'PERENNIAL_ASSIGNMENT_PREVIEW_FAILED');process.exitCode=1;});
}
