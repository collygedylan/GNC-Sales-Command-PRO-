import { buildErpDriveStockWriteFixture } from './erp-drive-stock-write-fixtures.mjs';

export function buildManualErpPreservationFixture() {
  let sql = buildErpDriveStockWriteFixture({ rawLocationNote: true });
  sql = sql.replace("update public.ph_master_inventory set spec='keep spec',av_note=", `update public.ph_master_inventory set
      caliper='2 inch',pick_note='Keep pick note',sales_note='Keep comments',eval_user='fixture',
      photos=jsonb_build_array(jsonb_build_object('url',photo_link)),photo_url=photo_link,
      photo_name='evidence.jpg',spec='keep spec',av_note=`);
  const snapshot = `create temporary table erp64_preserved as
select unique_id,jsonb_build_object('spec',spec,'caliper',caliper,'match',match,
  'loc_match_pct',loc_match_pct,'loc_photo_match',loc_photo_match,'av_note',av_note,
  'pick_note',pick_note,'sales_note',sales_note,'locationnote',locationnote,'eval_user',eval_user,
  'photos',photos,'photo_link',photo_link,'photo_url',photo_url,'photo_name',photo_name,'photo_date',photo_date) evidence
from public.ph_master_inventory where unique_id like 'erp-delta-fixture-%';
`;
  sql = sql.replace('create temporary table erp_delta_fixture_input as', snapshot + 'create temporary table erp_delta_fixture_input as');
  return sql + `
do $preserved$
begin
  assert not exists(select 1 from erp64_preserved prior join public.ph_master_inventory m using(unique_id)
    where prior.evidence is distinct from (select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(m))
      where key in (select jsonb_object_keys(prior.evidence)))), 'all populated app evidence must survive both ERP deltas';
end
$preserved$;`;
}
