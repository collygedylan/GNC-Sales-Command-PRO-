import {sqlStatements} from '../../scripts/database-catalog.mjs';

function replaceAssertion(source,label,replacement) {
  const matches=sqlStatements(source).filter(statement=>statement.includes("'"+label+"'"));
  if(matches.length!==1) throw new Error('CANONICAL_BULK_ASSERTION_CHANGED:'+label);
  return source.replace(matches[0],replacement);
}

export function currentBulkContract(source,read) {
  let result=source;
  const retired=sqlStatements(read('src/services/master-staging-fixtures/retired-crop.sql'))[0];
  const absent="not exists(select 1 from public.ph_crop_roll_drive_rows where master_unique_id like 'bulk-v1-%')";
  const replacements=[
    ['bulk publication mirrors every mapped field into crop-roll rows',retired],
    ['incoming holdstopcode cannot overwrite the live field',
      "select is((select holdstopcode from public.ph_master_inventory where unique_id='bulk-v1-existing'),'H','a first ERP source adopts its hold code');"],
    ['incoming holdstopreason cannot overwrite the live field',
      "select is((select holdstopreason from public.ph_master_inventory where unique_id='bulk-v1-existing'),'source hold','a first ERP source adopts its hold reason');"],
    ['new rows do not receive imported holdstopcode',
      "select is((select holdstopcode from public.ph_master_inventory where unique_id='bulk-v1-new'),'H','a new ERP row adopts its source hold code');"],
    ['ordinary app updates keep the crop-roll mirror current',
      `select ok(${absent} and (select av_note='ordinary app edit mirrored' from public.ph_master_inventory where unique_id='bulk-v1-existing'),'ordinary app evidence stays canonical while crop projection remains retired');`],
    ['a spoofed defer marker without bulk context cannot skip the ordinary mirror',
      `select ok(${absent} and (select av_note='spoofed defer marker ignored' from public.ph_master_inventory where unique_id='bulk-v1-existing'),'a forged defer marker cannot revive retired projection or discard canonical evidence');`],
    ['alias resolution leaves every crop-roll mirror field aligned with the canonical master row',
      `select ok(${absent} and exists(select 1 from public.ph_master_inventory where unique_id='bulk-v1-existing'),'alias resolution retains the canonical master without rebuilding retired crop rows');`],
    ['absent ERP stock and its mirror are pruned while an absent app-edited row remains',
      `select ok(${absent} and not exists(select 1 from public.ph_master_inventory where unique_id='bulk-v1-new') and exists(select 1 from public.ph_master_inventory where unique_id='bulk-v1-empty-app'),'absent ERP stock is pruned while canonical app-edited stock remains');`],
  ];
  for(const [label,replacement] of replacements) result=replaceAssertion(result,label,replacement);
  return result;
}
