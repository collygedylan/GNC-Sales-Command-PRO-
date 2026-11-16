create or replace function pg_temp.v2313_seed_split_rows(p_case text,v_prefix text)
returns jsonb language plpgsql as $seed$
declare
 v_rows jsonb;v_values jsonb;v_uid text;v_stable text;v_label text;
 v_fields jsonb:='["desigcust","desigitem","desigloc","locationnote","locationptn1","oversellpercentage","pullerresponsibility","salesnote","suspend"]';
begin
  v_rows:='[]'::jsonb;
  foreach v_label in array array['a','b','new'] loop
   v_uid:=v_prefix||v_label;
   v_values:=jsonb_build_object('unique_id',v_uid,'warehouseid','10','itemcode','SPLIT-'||p_case,
    'commonname','Genuine split canary','contsize','#1','locationcode','Z.96.001','lotcode','27.CANARY','source','LD',
    'desigcust',case v_label when 'a' then 'ABRN' when 'b' then 'CHRS' else null end,
    'desigitem',null,'desigloc',null,'priority','2','holdstopcode','SOURCE-H','holdstopreason','Source reason',
    'locationnote','Source note','locationptn1',null,'oversellpercentage',null,'pullerresponsibility',null,
    'salesnote',null,'suspend',null,'last_updated','2026-10-19T20:00:00Z','filename','split-canary.xlsx','concat','split-source');
   if p_case='retained' then
    v_values:=v_values||jsonb_build_object(
     'ptronhand',case v_label when 'a' then '11' when 'b' then '22' else '33' end,
     'ptravailable',case v_label when 'a' then '10' when 'b' then '20' else '30' end);
   end if;
   v_stable:=private.ph_master_inventory_stable_identity_v7(v_values);
   if v_label<>'new' then
    insert into public.ph_master_inventory(unique_id,warehouseid,itemcode,commonname,contsize,locationcode,lotcode,source,
     desigcust,priority,holdstopcode,holdstopreason,locationnote,photo_link,photo_name,photo_date,assignedto)
    values(v_uid,'10','SPLIT-'||p_case,'Genuine split canary','#1','Z.96.001','27.CANARY','LD',
     case v_label when 'a' then 'ABRN' else 'CHRS' end,case when p_case='retained' then '2' else '1' end,
     'APP-'||v_label,'App reason '||v_label,
     'App note '||v_label,'https://example.invalid/'||v_label||'.jpg','photo-'||v_label,statement_timestamp(),'dylan_collyge');
    insert into app_sync_private.ph_master_inventory_source_baselines(canonical_unique_id,lineage_key,priority,holdstopcode,holdstopreason)
    values(v_uid,private.ph_master_inventory_lineage_key_v1(v_values),case when p_case='retained' then '2' else '1' end,'SOURCE-H','Source reason')
    on conflict(canonical_unique_id) do update set lineage_key=excluded.lineage_key;
    insert into app_sync_private.ph_master_inventory_item6_source_v7(canonical_unique_id,stable_identity_key,field_values)
    select v_uid,v_stable,jsonb_object_agg(field_name,v_values->field_name) from jsonb_array_elements_text(v_fields) as fields(field_name)
    on conflict(canonical_unique_id) do update set stable_identity_key=excluded.stable_identity_key,field_values=excluded.field_values;
    if p_case='retained' then
     -- Isolate new-split publication from the established priority-change
     -- evidence reset rule. Quantities and revision metadata must still update.
     perform set_config('agdata.bulk_import.ph_master_inventory','on',true);
     update public.ph_master_inventory set ptronhand='5',ptravailable='4',
      filename='prior-split.xlsx',last_updated='2026-10-18T20:00:00Z'
     where unique_id=v_uid;
     perform set_config('agdata.bulk_import.ph_master_inventory','off',true);
    end if;
   end if;
   if not(p_case='omitted' and v_label='b') then
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object('values',v_values,'rawFields',v_fields));
   end if;
  end loop;
  if p_case='pending' then
   insert into app_sync_private.ph_master_inventory_item6_edits_v7(canonical_unique_id,field_name,stable_identity_key,source_value,app_value,pending)
   values(v_prefix||'a','desigcust',v_stable,'ABRN','APP-ABRN',true);
   update public.ph_master_inventory set desigcust='APP-ABRN' where unique_id=v_prefix||'a';
  end if;
 return v_rows;
end $seed$;
