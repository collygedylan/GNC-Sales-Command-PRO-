import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function readSql(name) {
    return readFileSync(new URL(`../sql/${name}.sql`,import.meta.url),'utf8');
}

function replaceFixtureAnchor(source, before, after) {
    assert.equal(source.split(before).length,2,`Expected one SQL fixture anchor ${before}`);
    return source.replace(before,after);
}

function withRawLocationNote(semantic) {
    const rawFields = "'rawFields','[]'::jsonb";
    assert.equal(semantic.split(rawFields).length,3);
    semantic=replaceFixtureAnchor(semantic,"'filename','new.xlsx','spec'",`'locationnote',
      case when m.unique_id='erp-delta-fixture-stock' then 'New Argos note' else 'Old Argos note' end,
      'filename','new.xlsx','spec'`);
    semantic=replaceFixtureAnchor(semantic,"private.ph_master_inventory_stable_identity_v7(incoming),'{}'",
        "private.ph_master_inventory_stable_identity_v7(incoming),'{\"locationnote\":\"Old Argos note\"}'");
    semantic=replaceFixtureAnchor(semantic,'from erp_delta_fixture_input on conflict(canonical_unique_id) do nothing;',
        'from erp_delta_fixture_input on conflict(canonical_unique_id) do update set field_values=excluded.field_values;');
    semantic=replaceFixtureAnchor(semantic,'do $evaluation$',`update public.ph_master_inventory set locationnote='Live app note'
where unique_id like 'erp-delta-fixture-%';
do $evaluation$`);
    return semantic.replaceAll(rawFields,"'rawFields','[\"locationnote\"]'::jsonb");
}

const assertExactRawNote = `do $note$
begin
  if not exists(select 1 from app_sync_private.ph_master_inventory_item6_source_v7 i
      join app_sync_private.ph_master_bulk_import_source_v1 s using(canonical_unique_id)
      join public.ph_master_inventory m on m.unique_id=i.canonical_unique_id
      where m.unique_id='erp-delta-fixture-stock' and m.locationnote='Live app note'
        and i.field_values->>'locationnote'='New Argos note' and s.source_unique_id='raw-erp-delta-fixture-stock')
    or exists(select 1 from app_sync_private.ph_master_inventory_item6_source_v7 i
      where i.canonical_unique_id='erp-delta-fixture-same' and i.field_values->>'locationnote' is distinct from 'Old Argos note') then
    raise exception 'ERP_DRIVE_FINAL_MAP_LOST_RAW_NOTE_OR_PHYSICAL_IDENTITY';
  end if;
end
$note$;`;

export function buildErpDriveStockWriteFixture({unprovenAlias = false, rawLocationNote = false} = {}) {
    let semantic = readSql('erp-drive-semantic-delta-fixture');
    if (unprovenAlias) {
        semantic = replaceFixtureAnchor(semantic,"select canonical_uid,source_uid,repeat('f',64)",
            "select canonical_uid,'former-'||source_uid,repeat('f',64)");
        semantic = replaceFixtureAnchor(semantic,'if (select count(*) from pg_temp.ph_master_bulk_prior_alias_v3046)<>2',
            'if (select count(*) from pg_temp.ph_master_bulk_prior_alias_v3046)<>0');
    }
    if (rawLocationNote) semantic=withRawLocationNote(semantic);
    return [readSql('erp-drive-single-stock-write-probe'),semantic,`do $test$
begin
  if (select count(*) from pg_temp.erp_drive_single_write_probe)<>1
    or not exists(select 1 from pg_temp.erp_drive_single_write_probe where name_changed and raw_stock_changed) then
    raise exception 'ERP_DRIVE_RAW_STOCK_STILL_USES_SECOND_WRITE: %',
      (select jsonb_agg(p) from pg_temp.erp_drive_single_write_probe p);
  end if;
end
$test$;`,rawLocationNote ? assertExactRawNote : ''].join('\n');
}
