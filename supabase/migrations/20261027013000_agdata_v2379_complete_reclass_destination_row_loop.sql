begin;
set local lock_timeout = '1500ms';
set local statement_timeout = '10s';

-- Reclass must resolve the locked current physical source tuple rather than
-- reject a stale client UID/snapshot. Quantity limits are still validated
-- against the current row under the existing transaction lock.
do $migration$
declare
  target regprocedure := 'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure;
  definition text := pg_get_functiondef(target);
  old_text text;
  new_text text;
begin
  if position('reclass-destination-row-loop-v2379' in definition) > 0 then return; end if;

  old_text := 'join public.ph_master_inventory m on m.unique_id=btrim(coalesce(e.value#>>''{source,uniqueId}'',''''))';
  new_text := $new$-- reclass-destination-row-loop-v2379: prefer source UID, then the exact normalized item/location/lot tuple.
  join lateral (
    select candidate.* from public.ph_master_inventory candidate
    where candidate.unique_id=btrim(coalesce(e.value#>>'{source,uniqueId}',''))
      or (upper(btrim(coalesce(candidate.itemcode,'')))=upper(btrim(coalesce(e.value#>>'{source,identity,itemcode}','')))
        and upper(btrim(coalesce(candidate.locationcode,'')))=upper(btrim(coalesce(e.value#>>'{source,identity,locationcode}','')))
        and upper(btrim(coalesce(candidate.lotcode,'')))=upper(btrim(coalesce(e.value#>>'{source,identity,lotcode}',''))))
    order by (candidate.unique_id=btrim(coalesce(e.value#>>'{source,uniqueId}',''))) desc,candidate.unique_id
    limit 1
  ) m on true$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text) <> 1 then
    raise exception 'AGDATA_V2379_SOURCE_TUPLE_ANCHOR_MISMATCH';
  end if;
  definition := replace(definition,old_text,new_text);

  old_text := $old$if source_count<>jsonb_array_length(p_moves) then raise exception using errcode='PT409',message='INVENTORY_RECLASS_SOURCE_MISSING'; end if;
  analyze pg_temp.reclass_batch_sources_v1;$old$;
  new_text := $new$if source_count<>jsonb_array_length(p_moves) then raise exception using errcode='PT409',message='INVENTORY_RECLASS_SOURCE_MISSING'; end if;
  if exists(select 1 from jsonb_array_elements(p_moves) with ordinality e(value,ordinality)
    where not exists(select 1 from public.ph_master_inventory exact_source
        where exact_source.unique_id=btrim(coalesce(e.value#>>'{source,uniqueId}','')))
      and (select count(*) from public.ph_master_inventory candidate
        where upper(btrim(coalesce(candidate.itemcode,'')))=upper(btrim(coalesce(e.value#>>'{source,identity,itemcode}','')))
          and upper(btrim(coalesce(candidate.locationcode,'')))=upper(btrim(coalesce(e.value#>>'{source,identity,locationcode}','')))
          and upper(btrim(coalesce(candidate.lotcode,'')))=upper(btrim(coalesce(e.value#>>'{source,identity,lotcode}',''))))>1) then
    raise exception using errcode='PT409',message='INVENTORY_RECLASS_SOURCE_AMBIGUOUS';
  end if;
  analyze pg_temp.reclass_batch_sources_v1;$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text) <> 1 then
    raise exception 'AGDATA_V2379_SOURCE_AMBIGUITY_ANCHOR_MISMATCH';
  end if;
  definition := replace(definition,old_text,new_text);

  old_text := $old$left join public.ph_master_inventory m on
      coalesce(m.warehouseid,m.warehousei,'')=coalesce(b.warehouseid::text,b.warehousei::text,'')
      and coalesce(m.itemcode,'')=coalesce(b.itemcode::text,'')
      and coalesce(m.contsize,'')=coalesce(b.contsize::text,'')
      and coalesce(m.locationcode,'')=coalesce(b.locationcode::text,'')
      and coalesce(m.lotcode,'')=t.destination_lot
      and coalesce(m.source,'')=coalesce(b.source::text,'')
      and coalesce(m.desigitem,'')=coalesce(b.desigitem::text,'')
      and coalesce(m.desigcust,'')=coalesce(b.desigcust::text,'')
      and coalesce(m.desigloc,'')=coalesce(b.desigloc::text,'')$old$;
  new_text := $new$left join public.ph_master_inventory m on
      upper(btrim(coalesce(m.itemcode,'')))=upper(btrim(coalesce(b.itemcode::text,'')))
      and upper(btrim(coalesce(m.locationcode,'')))=upper(btrim(coalesce(b.locationcode::text,'')))
      and upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(t.destination_lot,'')))$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text) <> 1 then
    raise exception 'AGDATA_V2379_DESTINATION_TUPLE_ANCHOR_MISMATCH';
  end if;
  definition := replace(definition,old_text,new_text);

  -- Use the selected live row as the snapshot baseline. The remaining batch
  -- validation still checks role, assignment, current quantities, season,
  -- source uniqueness and destination ambiguity.
  old_text := 'gen_random_uuid(),e.value#>''{source,identity}'',private.ph_master_inventory_lineage_key_v1(j.source_before),';
  new_text := $new$gen_random_uuid(),jsonb_build_object('unique_id',j.source_before->'unique_id','itemcode',j.source_before->'itemcode',
      'contsize',j.source_before->'contsize','locationcode',j.source_before->'locationcode','lotcode',j.source_before->'lotcode',
      'season',j.source_before->'season','ptronhand',j.source_before->'ptronhand','ptravailable',j.source_before->'ptravailable'),
    private.ph_master_inventory_lineage_key_v1(j.source_before),$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text) <> 1 then
    raise exception 'AGDATA_V2379_LIVE_SOURCE_SNAPSHOT_ANCHOR_MISMATCH';
  end if;
  definition := replace(definition,old_text,new_text);

  -- Clone source catalog/location evidence into a newly inserted destination.
  old_text := '''qualitycode'',''field_tag_color'',''fieldtagcolor'',''s_lts'',''plantgroupcode'',''listprice'',''itemspec'',''desigitem'',''desigcust'',''desigloc'',';
  new_text := old_text||'''warehousename'',''equiv_unit'',''brand'',''hz'',''priority'',''photo_url'',''photos'',''photo_date'',''spec'',''caliper'',''loc_match_pct'',''av_note'',''pick_note'',''sales_note'',''locationnote'',''locationptn1'',';
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text) <> 1 then
    raise exception 'AGDATA_V2379_DESTINATION_EVIDENCE_ANCHOR_MISMATCH';
  end if;
  definition := replace(definition,old_text,new_text);

  old_text := '||jsonb_build_object(''ptronhand'',t.quantity::text,''ptravailable'',t.quantity::text)';
  new_text := old_text||$new$||(select jsonb_build_object('s_lts',coalesce((select mode() within group(order by private.reclass_numeric_v1(m.s_lts))
        from public.ph_master_inventory m where upper(btrim(coalesce(m.itemcode,'')))=upper(btrim(coalesce(sj.source_before->>'itemcode','')))
          and upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(t.destination_lot,'')))),0)::text)
    ||jsonb_build_object('loc_photo_match',case
      when private.reclass_numeric_v1(sj.source_before->>'loc_match_pct')>0
        then round(t.quantity*private.reclass_numeric_v1(sj.source_before->>'loc_match_pct')/100.0)
      else null end)
    from pg_temp.reclass_batch_source_json_v1 sj where sj.source_index=t.source_index)$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text) <> 1 then
    raise exception 'AGDATA_V2379_DESTINATION_PHOTO_MATCH_ANCHOR_MISMATCH';
  end if;
  definition := replace(definition,old_text,new_text);

  old_text := '''unique_id'',t.destination_uid,''lotcode'',t.destination_lot,''season'',t.destination_season,';
  new_text := old_text||'''saleyear'',split_part(t.destination_lot,''.'',1),';
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text) <> 1 then
    raise exception 'AGDATA_V2379_DESTINATION_SALEYEAR_ANCHOR_MISMATCH';
  end if;
  definition := replace(definition,old_text,new_text);
  execute definition;
end
$migration$;

-- Revision zero means the UI has no usable watermark. The service wrapper
-- already acquires and passes the current locked revision for each new command.
do $migration$
declare
  target regprocedure := 'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure;
  definition text := pg_get_functiondef(target);
  old_text text := 'or (p_expected_revision is not null and p_expected_revision < 1)';
  new_text text := 'or (p_expected_revision is not null and p_expected_revision < 0)';
begin
  if position('p_expected_revision < 0' in definition)>0 then return; end if;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
    raise exception 'AGDATA_V2379_ZERO_REVISION_ANCHOR_MISMATCH';
  end if;
  execute replace(definition,old_text,new_text);
end
$migration$;

-- The master schema acquired location-evidence columns after the original
-- 213-column codec. Compare receipts to the actual table schema, retaining
-- strict key-set equality instead of rejecting every valid current receipt.
do $migration$
declare
  definition text := pg_get_functiondef('private.encode_inventory_reclass_rows_v1(jsonb)'::regprocedure);
begin
  if position('expected_columns' in definition)>0 then return; end if;
  if position('=213' in definition)=0 or position('<>213' in definition)=0 then
    raise exception 'AGDATA_V2379_RECEIPT_SCHEMA_ANCHOR_MISMATCH';
  end if;
  definition := replace(definition,'row_columns text[];', 'row_columns text[]; expected_columns text[];');
  definition := replace(definition,E'begin\n',E'begin\n  select array_agg(attname::text order by attname::text) into expected_columns\n  from pg_catalog.pg_attribute where attrelid=\'public.ph_master_inventory\'::regclass and attnum>0 and not attisdropped;\n');
  definition := replace(definition,'(select count(*) from jsonb_object_keys(s.row_value))=213','s.candidate_columns=expected_columns');
  definition := replace(definition,'cardinality(row_columns)<>213','row_columns is distinct from expected_columns');
  execute definition;
end
$migration$;


-- Apply the user's reviewed 276-plant repair once through the same atomic
-- quantity/season-stock/outbox RPC, preserving its receipt and replay key.
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
do $repair$
declare
  source_row public.ph_master_inventory%rowtype;
  actor uuid;
  receipt jsonb;
begin
  select * into strict source_row from public.ph_master_inventory
    where btrim(itemcode)='004103.010.1' and locationcode='C.15.000' and lotcode='27.S1' for update;
  if private.reclass_numeric_v1(source_row.ptronhand)=808
     and private.reclass_numeric_v1(source_row.ptravailable)=808
     and not exists(select 1 from public.ph_master_inventory where btrim(itemcode)='004103.010.1'
       and locationcode='C.15.000' and lotcode='27.F1') then
    select id into strict actor from public.profiles where username='dylan_collyge';
    receipt:=public.apply_inventory_reclass_moves_with_delivery_v1(actor,'reclass-v2379-blue-dart-reviewed-repair',0,
      jsonb_build_array(jsonb_build_object('source',jsonb_build_object('uniqueId',source_row.unique_id,
        'identity',jsonb_build_object('unique_id',source_row.unique_id,'itemcode',source_row.itemcode,
          'contsize',source_row.contsize,'locationcode',source_row.locationcode,'lotcode',source_row.lotcode,
          'season',source_row.season,'ptronhand',source_row.ptronhand,'ptravailable',source_row.ptravailable)),
        'lines',jsonb_build_array(jsonb_build_object('direction','move_up','destinationSeason','F1','quantity',276)))),
      'master-null-elision-v1');
    if receipt->>'ok'<>'true' or receipt->>'emailQueued'<>'true' then
      raise exception 'AGDATA_V2379_REPAIR_OR_OUTBOX_FAILED';
    end if;
  end if;
  if not exists(select 1 from public.ph_master_inventory where btrim(itemcode)='004103.010.1'
      and locationcode='C.15.000' and lotcode='27.S1' and ptronhand='532' and ptravailable='532' and s_lts='253')
    or not exists(select 1 from public.ph_master_inventory where btrim(itemcode)='004103.010.1'
      and locationcode='C.15.000' and lotcode='27.F1' and ptronhand='276' and ptrreviewed='0' and ptravailable='276'
      and s_lts='0' and saleyear='27' and season='F1' and photo_date::date='2026-10-26' and spec='8-10" H')
    or (select sum(private.reclass_numeric_v1(ptronhand)) from public.ph_master_inventory
      where btrim(itemcode)='004103.010.1' and locationcode='C.15.000')<>878
    or (select count(*) from public.ph_master_inventory where btrim(itemcode)='004103.010.1'
      and lotcode='27.F1' and s_lts='0')<>3 then
    raise exception 'AGDATA_V2379_REPAIR_STATE_CHANGED';
  end if;
end
$repair$;

insert into public.ph_app_settings(key,value,updated_by,updated_at)
values('app_version',jsonb_build_object('app_version','2.3.79','release','AgData v2.3.79'),'release-v2.3.79',now())
on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

notify pgrst,'reload schema';
commit;
