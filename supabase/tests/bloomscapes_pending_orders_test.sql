\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAILED: %',label;end if;end$$;
insert into public.profiles values('54c87ebf-d76d-452b-96b4-beaaeb1742d9','dylan_collyge',null,null,false);
insert into auth.sessions values('11111111-1111-4111-8111-111111111111','54c87ebf-d76d-452b-96b4-beaaeb1742d9',now()+interval '1 day');
insert into public.ph_app_settings values('current_season_salesyear','{"seasonCode":"F1","salesYear":27}');
insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,season,saleyear,listprice,s_lts,ptronhand,spec) values
 ('fixture-a','TEST-OAK','Test Oak','#5','TEST.A','27.F1','F1','27','23.00','100','60','4 ft'),
 ('fixture-b','TEST-OAK','Test Oak','#5','TEST.B','26.F1','F1','26','0.01','100','70','4 ft');
select set_config('request.jwt.claims',jsonb_build_object('sub','54c87ebf-d76d-452b-96b4-beaaeb1742d9','session_id','11111111-1111-4111-8111-111111111111','iss','https://kzrnyjsosryejjejliii.supabase.co/auth/v1','exp',extract(epoch from now())+3600)::text,true);
do $$
declare saved jsonb; payload jsonb; request uuid:=gen_random_uuid(); ack jsonb; ack2 jsonb; cart uuid; before_stock jsonb; initial_claims text:=current_setting('request.jwt.claims'); row_hash text:=encode(sha256(convert_to('fixture-a','UTF8')),'hex');
begin
  select jsonb_agg(to_jsonb(m) order by unique_id) into before_stock from public.ph_master_inventory m;
  perform pg_temp.assert_true(bloomscapes_private.price_cents('$1,234.50')=123450,'price parsing');
  perform pg_temp.assert_true(bloomscapes_private.price_cents('1.234') is null,'reject fractional-cent source price');
  payload:=jsonb_build_object('cartId',null,'revision',0,'tier','retail','customerName','Synthetic test','note','No business effect','lines',jsonb_build_array(jsonb_build_object('rowId',row_hash,'quantity',2),jsonb_build_object('rowId',encode(sha256(convert_to('fixture-b','UTF8')),'hex'),'quantity',3)));
  saved:=public.bloomscapes_pending_command('save_cart',payload,request);
  cart:=(saved->'cart'->>'id')::uuid;
  perform pg_temp.assert_true((saved->'cart'->'lines'->0->>'unitCents')::integer=5750,'retail multiplier');
  perform pg_temp.assert_true((saved->'cart'->'lines'->1->>'unitCents')::integer=3,'half cent rounds up');
  perform pg_temp.assert_true(saved=public.bloomscapes_pending_command('save_cart',payload,request),'lost save response retry');
  begin perform public.bloomscapes_pending_command('save_cart',payload||'{"note":"changed"}',request);raise exception 'FAILED: token collision accepted';exception when raise_exception then if sqlerrm like 'FAILED:%' then raise;end if;end;
  begin perform public.bloomscapes_pending_command('save_cart',payload,gen_random_uuid());raise exception 'FAILED: stale edit accepted';exception when raise_exception then if sqlerrm like 'FAILED:%' then raise;end if;end;
  update public.ph_master_inventory set listprice='24' where unique_id='fixture-a';
  begin perform public.bloomscapes_pending_command('checkout',jsonb_build_object('cartId',cart,'revision',1),gen_random_uuid());raise exception 'FAILED: changed quote accepted';exception when raise_exception then if sqlerrm like 'FAILED:%' then raise;end if;end;
  update public.ph_master_inventory set listprice='23.00' where unique_id='fixture-a';
  request:=gen_random_uuid();payload:=jsonb_build_object('cartId',cart,'revision',1);
  ack:=public.bloomscapes_pending_command('checkout',payload,request);
  ack2:=public.bloomscapes_pending_command('checkout',payload,request);
  perform pg_temp.assert_true(ack=ack2,'same checkout retry');
  perform pg_temp.assert_true(ack=public.bloomscapes_pending_command('checkout',payload,gen_random_uuid()),'different checkout token same cart');
  perform pg_temp.assert_true((select count(*) from bloomscapes_private.orders)=1,'one order per cart');
  perform pg_temp.assert_true(ack->'order'->>'payment_status'='unpaid' and ack->'order'->>'stock_reserved'='false','no payment or reservation');
  perform pg_temp.assert_true(ack->'order'->'lines'->0->'snapshot'->>'locationcode'='TEST.A','source location retained');
  perform pg_temp.assert_true(ack->'order'->'lines'->1->'snapshot'->>'lotcode'='26.F1','second location lot retained');
  perform pg_temp.assert_true((ack->'order'->>'subtotal_cents')::bigint=11509,'exact subtotal');
  delete from public.ph_master_inventory where unique_id='fixture-a';
  perform pg_temp.assert_true(ack=public.bloomscapes_pending_command('checkout',payload,request),'retry survives source import removal');
  perform pg_temp.assert_true((public.bloomscapes_pending_command('state','{}',null)->'orders'->0->'lines'->0->'snapshot'->>'itemcode')='TEST-OAK','snapshot survives import');
  insert into public.ph_master_inventory select * from jsonb_populate_recordset(null::public.ph_master_inventory,before_stock) where unique_id='fixture-a';
  ack2:=public.bloomscapes_pending_command('cancel_order',jsonb_build_object('orderId',ack->'order'->>'id','revision',1),gen_random_uuid());
  perform pg_temp.assert_true(ack2->'order'->>'status'='cancelled','cancel preserves history');
  perform pg_temp.assert_true((select jsonb_agg(to_jsonb(m) order by unique_id) from public.ph_master_inventory m)=before_stock,'checkout/cancel did not change stock');
  update public.profiles set disabled_at=now();
  begin perform public.bloomscapes_pending_command('checkout',payload,request);raise exception 'FAILED: disabled replay allowed';exception when insufficient_privilege then null;end;
  update public.profiles set disabled_at=null;
  update auth.sessions set not_after=now()-interval '1 second';
  begin perform public.bloomscapes_pending_command('state','{}',null);raise exception 'FAILED: expired session allowed';exception when insufficient_privilege then null;end;
  update auth.sessions set not_after=now()+interval '1 day';
  perform set_config('request.jwt.claims',(initial_claims::jsonb||jsonb_build_object('sub',gen_random_uuid()))::text,true);
  begin perform public.bloomscapes_pending_command('state','{}',null);raise exception 'FAILED: other user allowed';exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claims',initial_claims,true);
  update public.profiles set username='megan_kelly';
  begin perform public.bloomscapes_pending_command('state','{}',null);raise exception 'FAILED: equivalent username allowed';exception when insufficient_privilege then null;end;
  update public.profiles set username='dylan_collyge';
  perform pg_temp.assert_true(not has_table_privilege('authenticated','bloomscapes_private.orders','INSERT'),'no direct order inserts');
  perform pg_temp.assert_true(not has_function_privilege('anon','public.bloomscapes_pending_command(text,jsonb,uuid)','EXECUTE'),'anon cannot call wrapper');
  perform pg_temp.assert_true(not has_function_privilege('authenticated','bloomscapes_private.quote_lines(jsonb,text)','EXECUTE'),'helper is private');
end $$;
-- Test invalid quantities, missing source data, seasonal boundary, and forged fields.
do $$
declare value jsonb; line jsonb; saved jsonb;
begin
  line:=jsonb_build_object('rowId',encode(sha256(convert_to('fixture-a','UTF8')),'hex'),'quantity',1);
  foreach value in array array['0','-1','1.2','10001','null','"invalid"']::jsonb[] loop
    begin perform bloomscapes_private.quote_lines(jsonb_build_array(line||jsonb_build_object('quantity',value)),'retail');raise exception 'FAILED: invalid quantity';exception when raise_exception then if sqlerrm like 'FAILED:%' then raise;end if;end;
  end loop;
  begin perform bloomscapes_private.quote_lines(jsonb_build_array(line||'{"unitCents":1}'),'retail');raise exception 'FAILED: forged fields';exception when raise_exception then if sqlerrm like 'FAILED:%' then raise;end if;end;
  update public.ph_master_inventory set s_lts='0' where unique_id='fixture-a';
  begin perform bloomscapes_private.quote_lines(jsonb_build_array(line),'retail');raise exception 'FAILED: zero stock';exception when raise_exception then if sqlerrm like 'FAILED:%' then raise;end if;end;
  update public.ph_master_inventory set s_lts='100',season='S1' where unique_id='fixture-a';
  begin perform bloomscapes_private.quote_lines(jsonb_build_array(line),'retail');raise exception 'FAILED: wrong season';exception when raise_exception then if sqlerrm like 'FAILED:%' then raise;end if;end;
  update public.ph_master_inventory set season='F1',saleyear='28' where unique_id='fixture-a';
  begin perform bloomscapes_private.quote_lines(jsonb_build_array(line),'retail');raise exception 'FAILED: future year';exception when raise_exception then if sqlerrm like 'FAILED:%' then raise;end if;end;
end $$;
rollback;
select 'Pending order transaction tests passed; fixtures rolled back.' as result;
