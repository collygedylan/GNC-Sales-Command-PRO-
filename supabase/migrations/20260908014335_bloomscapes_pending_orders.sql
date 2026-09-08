-- Private pending requests only. Arogs owns stock; this migration never writes
-- inventory, reserves, Sales Office mirrors, payments, or notification tables.
create schema if not exists bloomscapes_private;
revoke all on schema bloomscapes_private from public, anon, authenticated;

create table bloomscapes_private.carts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  revision integer not null default 1 check (revision > 0),
  tier text not null check (tier in ('retail','wholesale')),
  customer_name text not null default '',
  note text not null default '',
  lines jsonb not null default '[]' check (jsonb_typeof(lines)='array' and jsonb_array_length(lines)<=50),
  submitted_order_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index bloomscapes_one_open_cart on bloomscapes_private.carts(owner_id) where submitted_order_id is null;
create table bloomscapes_private.orders (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null unique references bloomscapes_private.carts(id),
  owner_id uuid not null,
  revision integer not null default 1,
  status text not null default 'pending' check (status in ('pending','cancelled')),
  payment_status text not null default 'unpaid' check (payment_status='unpaid'),
  stock_reserved boolean not null default false check (not stock_reserved),
  tier text not null check (tier in ('retail','wholesale')),
  customer_name text not null,
  note text not null default '',
  subtotal_cents bigint not null check (subtotal_cents>=0),
  currency text not null default 'USD' check (currency='USD'),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);
create index bloomscapes_orders_owner_created on bloomscapes_private.orders(owner_id,created_at desc,id desc);
create table bloomscapes_private.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references bloomscapes_private.orders(id),
  position integer not null,
  source_row_id text not null,
  quantity integer not null check (quantity between 1 and 10000),
  unit_price_cents bigint not null check (unit_price_cents>0),
  snapshot jsonb not null,
  unique(order_id,position)
);
create table bloomscapes_private.commands (
  owner_id uuid not null,
  request_id uuid not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key(owner_id,request_id)
);
create index bloomscapes_commands_owner_created on bloomscapes_private.commands(owner_id,created_at desc);
alter table bloomscapes_private.carts enable row level security;
alter table bloomscapes_private.orders enable row level security;
alter table bloomscapes_private.order_lines enable row level security;
alter table bloomscapes_private.commands enable row level security;
revoke all on all tables in schema bloomscapes_private from public,anon,authenticated;

create function bloomscapes_private.assert_dylan() returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid:=auth.uid(); v_claims jsonb:=auth.jwt();
begin
  if v_id is distinct from '54c87ebf-d76d-452b-96b4-beaaeb1742d9'::uuid
     or v_claims->>'iss' is distinct from 'https://kzrnyjsosryejjejliii.supabase.co/auth/v1'
     or coalesce((v_claims->>'exp')::numeric,0)<=extract(epoch from now())
     or not exists(select 1 from public.profiles p where p.id=v_id and p.username='dylan_collyge'
       and p.disabled_at is null and (p.locked_until is null or p.locked_until<=now()) and p.must_change_password=false)
     or not exists(select 1 from auth.sessions s where s.id::text=v_claims->>'session_id' and s.user_id=v_id
       and (s.not_after is null or s.not_after>now())) then
    raise exception using errcode='42501',message='Only an active native dylan_collyge session can access pending orders.';
  end if;
  return v_id;
end $$;

create function bloomscapes_private.number_value(v text) returns numeric
language sql immutable set search_path='' as $$
 select case when replace(trim(v),',','') ~ '^-?[0-9]+([.][0-9]+)?$' and length(v)<32
   then replace(trim(v),',','')::numeric else null end
$$;
create function bloomscapes_private.price_cents(v text) returns bigint
language plpgsql immutable set search_path='' as $$
declare clean text:=replace(regexp_replace(trim(v),'^[$]',''),',',''); n numeric;
begin
  if clean is null or clean !~ '^[0-9]+([.][0-9]{1,2})?$' or length(clean)>16 then return null; end if;
  n:=clean::numeric*100;
  if n<=0 or n>100000000 then return null; end if;
  return n::bigint;
end $$;

-- The row hash is a lookup only, never a permanent batch ID. Orders receive
-- their own UUIDs and frozen source evidence, without a FK to imported rows.
create function bloomscapes_private.quote_lines(p_lines jsonb,p_tier text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_setting jsonb; current_season text; current_year numeric; input jsonb; source jsonb;
  source_rows jsonb; result jsonb:='[]'; row_season text; row_year numeric; lot_year numeric;
  qty numeric; wholesale bigint; unit_cents bigint; snap jsonb; row_hash text;
begin
  perform bloomscapes_private.assert_dylan();
  if p_tier not in ('retail','wholesale') or p_tier is null or jsonb_typeof(p_lines) is distinct from 'array'
    or jsonb_array_length(p_lines)>50 then raise exception 'Invalid cart.'; end if;
  if (select count(*) from jsonb_array_elements(p_lines))<>(select count(distinct value->>'rowId') from jsonb_array_elements(p_lines)) then
    raise exception 'Choose each inventory row only once.';
  end if;
  select value into current_setting from public.ph_app_settings where key='current_season_salesyear';
  if jsonb_typeof(current_setting)='string' then current_setting:=(current_setting#>>'{}')::jsonb; end if;
  current_season:=upper(regexp_replace(coalesce(current_setting->>'seasonCode',current_setting->>'season_code',current_setting->>'currentSeason',current_setting->>'current_season',current_setting->>'season'),'\s','','g'));
  current_season:=case current_season when 'F' then 'F1' when 'S' then 'S1' else current_season end;
  current_year:=bloomscapes_private.number_value(coalesce(current_setting->>'salesYear',current_setting->>'sales_year',current_setting->>'currentSalesYear',current_setting->>'current_sales_year',current_setting->>'salesyear'));
  if current_year between 2000 and 2099 then current_year:=current_year-2000; end if;
  if current_season is null or current_season not in ('F1','S1') or current_year is null or current_year<>trunc(current_year) or current_year not between 0 and 99 then raise exception 'AgMetric season settings are unavailable.'; end if;
  -- One bounded scan, not one inventory query per cart line. No stock locks or
  -- deductions are needed: this is explicitly NOT an availability promise.
  select coalesce(jsonb_object_agg(encode(sha256(convert_to(m.unique_id,'UTF8')),'hex'),to_jsonb(m)),'{}')
    into source_rows from public.ph_master_inventory m where encode(sha256(convert_to(m.unique_id,'UTF8')),'hex')
      in (select value->>'rowId' from jsonb_array_elements(p_lines));
  for input in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(input) is distinct from 'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('rowId','quantity')) then raise exception 'Invalid cart line fields.'; end if;
    row_hash:=input->>'rowId'; qty:=bloomscapes_private.number_value(input->>'quantity'); source:=source_rows->row_hash;
    if row_hash is null or row_hash !~ '^[a-f0-9]{64}$' or qty is null or qty<>trunc(qty) or qty not between 1 and 10000 then raise exception 'Use whole quantities from 1 to 10,000.'; end if;
    if source is null then raise exception 'An inventory row changed or was removed. Remove it and select the current row.'; end if;
    if trim(coalesce(source->>'itemcode',''))='' or trim(coalesce(source->>'locationcode',''))='' or trim(coalesce(source->>'lotcode',''))='' then raise exception 'Item, location and lot must be present before requesting this row.'; end if;
    row_season:=upper(regexp_replace(coalesce(nullif(source->>'season',''),substring(source->>'lotcode' from '\.\s*([a-zA-Z0-9]+)\s*$')),'\s','','g'));
    row_season:=case row_season when 'F' then 'F1' when 'S' then 'S1' else row_season end;
    row_year:=bloomscapes_private.number_value(source->>'saleyear');
    if row_year between 2000 and 2099 then row_year:=row_year-2000; end if;
    if row_year<>trunc(row_year) or row_year not between 0 and 99 then row_year:=null; end if;
    lot_year:=bloomscapes_private.number_value(substring(source->>'lotcode' from '^\s*([0-9]{2})\s*\.'));
    row_year:=greatest(row_year,lot_year);
    if row_season is distinct from current_season or row_year is null or row_year>current_year or coalesce(bloomscapes_private.number_value(source->>'s_lts'),0)<=0 then raise exception 'This row is no longer positive stock in the configured season and year.'; end if;
    if qty>coalesce(bloomscapes_private.number_value(source->>'s_lts'),0) or qty>coalesce(bloomscapes_private.number_value(source->>'ptronhand'),0) then raise exception 'Requested quantity exceeds the latest imported open stock or location on hand. Reduce the quantity.'; end if;
    wholesale:=bloomscapes_private.price_cents(source->>'listprice');
    if wholesale is null then raise exception 'A valid LISTPRICE is required before requesting this row.'; end if;
    unit_cents:=case when p_tier='retail' then round(wholesale*2.5)::bigint else wholesale end;
    snap:=jsonb_build_object('sourceId',source->>'unique_id','itemcode',source->>'itemcode','name',source->>'commonname',
      'size',source->>'contsize','locationcode',source->>'locationcode','lotcode',source->>'lotcode','season',row_season,'year',2000+row_year,
      'spec',source->>'spec','itemSpec',source->>'itemspec','caliper',source->>'caliper','photoLink',source->>'photo_link','photoName',source->>'photo_name',
      'photoUpdatedAt',source->>'av_rule_photo_updated_at','dateCompleted',source->>'date_completed',
      'openStock',source->>'s_lts','onHand',source->>'ptronhand','ptrAvailable',source->>'ptravailable','match',source->>'match','initialPtr',source->>'initial_ptr',
      'holdCode',source->>'holdstopcode','holdBegin',source->>'holdstopbegindate','holdApprovedAt',source->>'hold_release_approved_at',
      'designation',source->>'desigitem','assignment',source->>'app_tab_assignment','wholesaleCents',wholesale,'retailCents',round(wholesale*2.5)::bigint);
    result:=result||jsonb_build_array(jsonb_build_object('rowId',row_hash,'quantity',qty::integer,'unitCents',unit_cents,'snapshot',snap));
  end loop;
  return result;
end $$;

create function bloomscapes_private.order_json(p_id uuid) returns jsonb
language sql security definer set search_path='' as $$
  select to_jsonb(o)||jsonb_build_object('lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.position) from bloomscapes_private.order_lines l where l.order_id=o.id),'[]'))
  from bloomscapes_private.orders o where o.id=p_id and o.owner_id=bloomscapes_private.assert_dylan()
$$;
create function bloomscapes_private.command(p_action text,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=bloomscapes_private.assert_dylan(); cart bloomscapes_private.carts; ord bloomscapes_private.orders;
  receipt bloomscapes_private.commands; hash text; result jsonb; quoted jsonb; line jsonb; order_id uuid; pos integer:=0;
  before_time timestamptz; before_id uuid; keys text[];
begin
  if p_action is null or p_action not in ('state','save_cart','checkout','cancel_order') or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>50000 then raise exception 'Invalid pending-order command.'; end if;
  keys:=case p_action when 'state' then array['beforeTime','beforeId'] when 'save_cart' then array['cartId','revision','tier','lines','customerName','note'] when 'checkout' then array['cartId','revision'] else array['orderId','revision'] end;
  if exists(select 1 from jsonb_object_keys(p_payload) k where not(k=any(keys))) then raise exception 'Unexpected command fields.'; end if;
  if p_action='state' then
    before_time:=(p_payload->>'beforeTime')::timestamptz; before_id:=(p_payload->>'beforeId')::uuid;
    if (before_time is null)<>(before_id is null) then raise exception 'Invalid order cursor.'; end if;
    select * into cart from bloomscapes_private.carts where owner_id=actor and submitted_order_id is null;
    return jsonb_build_object('cart',case when cart.id is null then null else to_jsonb(cart) end,
      'orders',coalesce((select jsonb_agg(bloomscapes_private.order_json(page.id) order by page.created_at desc,page.id desc) from
        (select id,created_at from bloomscapes_private.orders where owner_id=actor and (before_time is null or (created_at,id)<(before_time,before_id)) order by created_at desc,id desc limit 25) page),'[]'),
      'mode','pending-unpaid','paymentEnabled',false,'stockReserved',false);
  end if;
  if p_request_id is null then raise exception 'A request token is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bloomscapes-pending:'||actor::text,0));
  hash:=encode(sha256(convert_to(jsonb_build_object('action',p_action,'payload',p_payload)::text,'UTF8')),'hex');
  select * into receipt from bloomscapes_private.commands where owner_id=actor and request_id=p_request_id;
  if found then
    if receipt.request_hash<>hash then raise exception 'Request token was already used with different details.'; end if;
    return receipt.response;
  end if;
  if (select count(*) from bloomscapes_private.commands where owner_id=actor and created_at>now()-interval '1 minute')>=60 then raise exception 'Too many changes. Wait one minute and retry the original request.'; end if;
  if p_action='save_cart' then
    select * into cart from bloomscapes_private.carts where owner_id=actor and submitted_order_id is null for update;
    if cart.id is null then
      if p_payload->>'cartId' is not null or coalesce((p_payload->>'revision')::integer,-1)<>0 then raise exception 'Cart changed. Refresh before editing.'; end if;
    elsif cart.id::text is distinct from p_payload->>'cartId' or cart.revision is distinct from (p_payload->>'revision')::integer then raise exception 'Cart changed. Refresh before editing.';
    end if;
    if length(coalesce(p_payload->>'customerName',''))>120 or length(coalesce(p_payload->>'note',''))>1000 then raise exception 'Customer name or note is too long.'; end if;
    quoted:=bloomscapes_private.quote_lines(p_payload->'lines',p_payload->>'tier');
    if cart.id is null then
      insert into bloomscapes_private.carts(owner_id,tier,customer_name,note,lines) values(actor,p_payload->>'tier',trim(coalesce(p_payload->>'customerName','')),trim(coalesce(p_payload->>'note','')),quoted) returning * into cart;
    else
      update bloomscapes_private.carts set revision=revision+1,tier=p_payload->>'tier',customer_name=trim(coalesce(p_payload->>'customerName','')),note=trim(coalesce(p_payload->>'note','')),lines=quoted,updated_at=now() where id=cart.id returning * into cart;
    end if;
    result:=jsonb_build_object('cart',to_jsonb(cart));
  elsif p_action='checkout' then
    select * into cart from bloomscapes_private.carts where id=(p_payload->>'cartId')::uuid and owner_id=actor for update;
    if cart.id is null then raise exception 'Cart not found.'; end if;
    if cart.submitted_order_id is not null then result:=jsonb_build_object('order',bloomscapes_private.order_json(cart.submitted_order_id));
    else
      if cart.revision is distinct from (p_payload->>'revision')::integer then raise exception 'Cart changed. Review the latest cart before submitting.'; end if;
      if jsonb_array_length(cart.lines)=0 or trim(cart.customer_name)='' then raise exception 'Add an item and customer name before submitting.'; end if;
      quoted:=bloomscapes_private.quote_lines((select jsonb_agg(jsonb_build_object('rowId',value->>'rowId','quantity',value->'quantity')) from jsonb_array_elements(cart.lines)),cart.tier);
      if quoted<>cart.lines then raise exception 'Inventory or pricing changed. Refresh the cart quote and review it before submitting.'; end if;
      insert into bloomscapes_private.orders(cart_id,owner_id,tier,customer_name,note,subtotal_cents)
        values(cart.id,actor,cart.tier,cart.customer_name,cart.note,(select sum((value->>'quantity')::bigint*(value->>'unitCents')::bigint) from jsonb_array_elements(quoted))) returning id into order_id;
      for line in select value from jsonb_array_elements(quoted) loop
        pos:=pos+1;
        insert into bloomscapes_private.order_lines(order_id,position,source_row_id,quantity,unit_price_cents,snapshot)
          values(order_id,pos,line->'snapshot'->>'sourceId',(line->>'quantity')::integer,(line->>'unitCents')::bigint,line->'snapshot');
      end loop;
      update bloomscapes_private.carts set submitted_order_id=order_id,revision=revision+1,updated_at=now() where id=cart.id;
      result:=jsonb_build_object('order',bloomscapes_private.order_json(order_id));
    end if;
  else
    select * into ord from bloomscapes_private.orders where id=(p_payload->>'orderId')::uuid and owner_id=actor for update;
    if ord.id is null then raise exception 'Order request not found.'; end if;
    if ord.status<>'cancelled' then
      if ord.revision is distinct from (p_payload->>'revision')::integer then raise exception 'Order changed. Refresh before cancelling.'; end if;
      update bloomscapes_private.orders set status='cancelled',revision=revision+1,cancelled_at=now() where id=ord.id;
    end if;
    result:=jsonb_build_object('order',bloomscapes_private.order_json(ord.id));
  end if;
  insert into bloomscapes_private.commands(owner_id,request_id,request_hash,response) values(actor,p_request_id,hash,result);
  return result;
end $$;

-- Only this narrow entrypoint is exposed. Privileged helpers live in a private
-- schema and recheck native identity; no direct table writes are granted.
create function public.bloomscapes_pending_command(p_action text,p_payload jsonb default '{}',p_request_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
  select bloomscapes_private.command(p_action,p_payload,p_request_id)
$$;
revoke all on all functions in schema bloomscapes_private from public,anon,authenticated;
revoke all on function public.bloomscapes_pending_command(text,jsonb,uuid) from public,anon,authenticated;
grant usage on schema bloomscapes_private to authenticated;
grant execute on function bloomscapes_private.command(text,jsonb,uuid) to authenticated;
grant execute on function public.bloomscapes_pending_command(text,jsonb,uuid) to authenticated;
