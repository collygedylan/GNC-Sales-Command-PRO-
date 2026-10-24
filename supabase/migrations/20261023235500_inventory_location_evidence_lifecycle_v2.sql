begin;
set local lock_timeout='1s';
set local statement_timeout='20s';

alter table app_sync_private.inventory_location_evidence_v1
  add column if not exists source_lotcode text,
  add column if not exists baseline_on_hand numeric,
  add column if not exists loc_match_pct numeric,
  add column if not exists initial_photo_match_qty numeric,
  add column if not exists current_photo_match_qty numeric,
  add column if not exists evaluated_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists cleared_at timestamptz,
  add column if not exists clear_reason text;

create or replace function private.inventory_location_evidence_number_v2(p_value text)
returns numeric language sql immutable set search_path='' as $fn$
  select case
    when nullif(btrim(coalesce(p_value,'')),'') ~ '^-?[0-9]+([.][0-9]+)?$'
      then btrim(p_value)::numeric
    else null
  end;
$fn$;

create or replace function private.inventory_location_evidence_expiry_v2(p_evaluated_at timestamptz)
returns timestamptz language sql stable set search_path='' as $fn$
  select case when p_evaluated_at is null then null else
    (((p_evaluated_at at time zone 'America/Chicago')::date + 10) + time '23:59:59')
      at time zone 'America/Chicago'
  end;
$fn$;

create or replace function private.inventory_location_evidence_qty_v2(
  p_baseline_on_hand numeric,p_initial_photo_match_qty numeric,p_current_on_hand numeric
) returns numeric language sql immutable set search_path='' as $fn$
  select case
    when p_baseline_on_hand is null or p_initial_photo_match_qty is null or p_current_on_hand is null then null
    else greatest(0,p_initial_photo_match_qty-greatest(0,p_baseline_on_hand-p_current_on_hand))
  end;
$fn$;

revoke all on function private.inventory_location_evidence_number_v2(text) from public,anon,authenticated;
revoke all on function private.inventory_location_evidence_expiry_v2(timestamptz) from public,anon,authenticated;
revoke all on function private.inventory_location_evidence_qty_v2(numeric,numeric,numeric) from public,anon,authenticated;

with history_ranked as (
  select h.*,
    upper(btrim(h.itemcode)) itemcode_key,
    upper(btrim(h.locationcode)) locationcode_key,
    coalesce(h.date_completed,h.updated_at) evidence_at,
    row_number() over (
      partition by upper(btrim(h.itemcode)),upper(btrim(h.locationcode))
      order by coalesce(h.date_completed,h.updated_at) desc,h.id desc
    ) evidence_rank
  from public.ph_request_history h
  where nullif(btrim(coalesce(h.itemcode,'')),'') is not null
    and nullif(btrim(coalesce(h.locationcode,'')),'') is not null
    and (h.date_completed is not null or lower(btrim(coalesce(h.req_status,''))) in ('complete','completed','done'))
), history_source as (
  select h.*,source_row.unique_id source_unique_id,source_row.lotcode source_lotcode,
    private.inventory_location_evidence_number_v2(source_row.ptronhand) current_on_hand,
    coalesce(
      private.inventory_location_evidence_number_v2(h.snapshot->>'ptronhand'),
      private.inventory_location_evidence_number_v2(h.snapshot->>'PTRONHAND'),
      private.inventory_location_evidence_number_v2(h.snapshot#>>'{master,ptronhand}'),
      private.inventory_location_evidence_number_v2(source_row.ptronhand)
    ) baseline_on_hand,
    private.inventory_location_evidence_number_v2(coalesce(h.req_match,h.snapshot->>'req_match',h.snapshot->>'match')) loc_match_pct,
    coalesce(nullif(btrim(h.req_photo_link),''),nullif(btrim(h.photo_link),''),
      nullif(btrim(h.snapshot->>'req_photo_link'),''),nullif(btrim(h.snapshot->>'photo_link'),'')) harvested_photo_link,
    coalesce(nullif(btrim(h.req_photo_name),''),nullif(btrim(h.photo_name),''),
      nullif(btrim(h.snapshot->>'req_photo_name'),''),nullif(btrim(h.snapshot->>'photo_name'),'')) harvested_photo_name
  from history_ranked h
  left join lateral (
    select m.unique_id,m.lotcode,m.ptronhand
    from public.ph_master_inventory m
    where upper(btrim(m.itemcode))=h.itemcode_key
      and upper(btrim(m.locationcode))=h.locationcode_key
    order by (m.unique_id=coalesce(h.master_id,h.master_unique_id)) desc,
      (upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(h.lotcode,'')))) desc,
      m.last_updated desc nulls last,m.unique_id
    limit 1
  ) source_row on true
  where h.evidence_rank=1
    and h.evidence_at is not null
    and clock_timestamp()<=private.inventory_location_evidence_expiry_v2(h.evidence_at)
), history_prepared as (
  select h.*,
    round(h.baseline_on_hand*h.loc_match_pct/100) initial_photo_match_qty,
    private.inventory_location_evidence_qty_v2(
      h.baseline_on_hand,round(h.baseline_on_hand*h.loc_match_pct/100),h.current_on_hand
    ) current_photo_match_qty
  from history_source h
  where h.baseline_on_hand is not null and h.loc_match_pct between 0 and 100
    and coalesce(h.harvested_photo_link,h.harvested_photo_name,nullif(btrim(h.req_spec),''),
      nullif(btrim(h.av_note),''),nullif(btrim(h.req_pic_note),''),nullif(btrim(h.req_comments),'')) is not null
)
insert into app_sync_private.inventory_location_evidence_v1 as evidence(
  itemcode_key,locationcode_key,itemcode,locationcode,source_unique_id,source_lotcode,
  spec,caliper,match,loc_match_qty,initial_ptr,av_note,pic_note,sales_note,
  photo_link,photo_name,date_completed,app_tab_assignment,updated_at,updated_by,
  baseline_on_hand,loc_match_pct,initial_photo_match_qty,current_photo_match_qty,
  evaluated_at,expires_at,cleared_at,clear_reason
)
select itemcode_key,locationcode_key,itemcode,locationcode,source_unique_id,source_lotcode,
  coalesce(nullif(btrim(req_spec),''),nullif(btrim(snapshot->>'req_spec'),'')),
  coalesce(nullif(btrim(req_caliper),''),nullif(btrim(snapshot->>'req_caliper'),'')),
  loc_match_pct::text,current_photo_match_qty::text,baseline_on_hand::text,
  coalesce(nullif(btrim(av_note),''),nullif(btrim(snapshot->>'av_note'),'')),
  coalesce(nullif(btrim(req_pic_note),''),nullif(btrim(snapshot->>'req_pic_note'),'')),
  coalesce(nullif(req_comments,''),nullif(snapshot->>'req_sales_note',''),nullif(snapshot->>'req_comments','')),
  harvested_photo_link,harvested_photo_name,evidence_at,coalesce(nullif(btrim(app_tab_assignment),''),'season'),
  evidence_at,'request-history-harvest-v2',baseline_on_hand,loc_match_pct,
  initial_photo_match_qty,current_photo_match_qty,evidence_at,
  private.inventory_location_evidence_expiry_v2(evidence_at),null,null
from history_prepared
where initial_photo_match_qty>0 and current_photo_match_qty>0
on conflict(itemcode_key,locationcode_key) do update set
  itemcode=excluded.itemcode,locationcode=excluded.locationcode,
  source_unique_id=excluded.source_unique_id,source_lotcode=excluded.source_lotcode,
  spec=excluded.spec,caliper=excluded.caliper,match=excluded.match,
  loc_match_qty=excluded.loc_match_qty,initial_ptr=excluded.initial_ptr,
  av_note=excluded.av_note,pic_note=excluded.pic_note,sales_note=excluded.sales_note,
  photo_link=excluded.photo_link,photo_name=excluded.photo_name,date_completed=excluded.date_completed,
  app_tab_assignment=excluded.app_tab_assignment,updated_at=excluded.updated_at,updated_by=excluded.updated_by,
  baseline_on_hand=excluded.baseline_on_hand,loc_match_pct=excluded.loc_match_pct,
  initial_photo_match_qty=excluded.initial_photo_match_qty,
  current_photo_match_qty=excluded.current_photo_match_qty,
  evaluated_at=excluded.evaluated_at,expires_at=excluded.expires_at,cleared_at=null,clear_reason=null
where excluded.evaluated_at>coalesce(evidence.evaluated_at,evidence.date_completed,evidence.updated_at,'epoch'::timestamptz);

with resolved as (
  select e.itemcode_key,e.locationcode_key,m.unique_id source_unique_id,m.lotcode source_lotcode,
    private.inventory_location_evidence_number_v2(m.ptronhand) current_on_hand,
    case
      when coalesce(private.inventory_location_evidence_number_v2(e.initial_ptr),0)>0
        then private.inventory_location_evidence_number_v2(e.initial_ptr)
      else private.inventory_location_evidence_number_v2(m.ptronhand)
    end baseline_on_hand,
    private.inventory_location_evidence_number_v2(e.match) loc_match_pct,
    coalesce(e.date_completed,e.updated_at) evaluated_at
  from app_sync_private.inventory_location_evidence_v1 e
  left join lateral (
    select m.* from public.ph_master_inventory m
    where upper(btrim(m.itemcode))=e.itemcode_key and upper(btrim(m.locationcode))=e.locationcode_key
    order by (
      private.inventory_location_evidence_number_v2(e.loc_match_qty) is not null
      and private.inventory_location_evidence_number_v2(e.match) is not null
      and round(coalesce(private.inventory_location_evidence_number_v2(m.ptronhand),0)
        *private.inventory_location_evidence_number_v2(e.match)/100)
        =private.inventory_location_evidence_number_v2(e.loc_match_qty)
    ) desc,(m.unique_id=e.source_unique_id) desc,
      (upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(e.source_lotcode,'')))) desc,
      m.last_updated desc nulls last,m.unique_id
    limit 1
  ) m on true
), prepared as (
  select r.*,
    case when r.baseline_on_hand is not null and r.loc_match_pct between 0 and 100
      then round(r.baseline_on_hand*r.loc_match_pct/100) end initial_photo_match_qty
  from resolved r
)
update app_sync_private.inventory_location_evidence_v1 e set
  source_unique_id=coalesce(p.source_unique_id,e.source_unique_id),
  source_lotcode=coalesce(p.source_lotcode,e.source_lotcode),
  baseline_on_hand=p.baseline_on_hand,loc_match_pct=p.loc_match_pct,
  initial_photo_match_qty=p.initial_photo_match_qty,
  current_photo_match_qty=private.inventory_location_evidence_qty_v2(
    p.baseline_on_hand,p.initial_photo_match_qty,p.current_on_hand
  ),
  evaluated_at=p.evaluated_at,
  expires_at=private.inventory_location_evidence_expiry_v2(p.evaluated_at),
  date_completed=p.evaluated_at,
  loc_match_qty=private.inventory_location_evidence_qty_v2(
    p.baseline_on_hand,p.initial_photo_match_qty,p.current_on_hand
  )::text
from prepared p
where e.itemcode_key=p.itemcode_key and e.locationcode_key=p.locationcode_key
  and coalesce(e.spec,e.match,e.loc_match_qty,e.av_note,e.pic_note,e.sales_note,e.photo_link,e.photo_name) is not null;

update app_sync_private.inventory_location_evidence_v1 e set
  spec=null,match=null,loc_match_qty=null,av_note=null,pic_note=null,sales_note=null,
  photo_link=null,photo_name=null,date_completed=null,cleared_at=clock_timestamp(),
  clear_reason=case when clock_timestamp()>e.expires_at then 'expired' else 'depleted' end,
  updated_at=clock_timestamp()
where e.cleared_at is null and (
  (e.initial_photo_match_qty>0 and coalesce(e.current_photo_match_qty,0)<=0)
  or (e.expires_at is not null and clock_timestamp()>e.expires_at)
);

create or replace function private.normalize_inventory_location_evidence_v2()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare
  source_row public.ph_master_inventory%rowtype;
  current_on_hand numeric;
  evaluation_event boolean:=false;
  has_evidence boolean:=false;
begin
  has_evidence:=coalesce(new.spec,new.match,new.loc_match_qty,new.av_note,new.pic_note,
    new.sales_note,new.photo_link,new.photo_name,new.date_completed::text) is not null;
  select * into source_row from public.ph_master_inventory m
  where upper(btrim(m.itemcode))=new.itemcode_key and upper(btrim(m.locationcode))=new.locationcode_key
  order by (m.unique_id=new.source_unique_id) desc,
    (upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(new.source_lotcode,'')))) desc,
    m.last_updated desc nulls last,m.unique_id limit 1;
  if found then
    new.source_unique_id:=source_row.unique_id;
    new.source_lotcode:=source_row.lotcode;
    current_on_hand:=private.inventory_location_evidence_number_v2(source_row.ptronhand);
  end if;
  if tg_op='INSERT' then
    evaluation_event:=has_evidence;
  else
    evaluation_event:=has_evidence and (
      new.date_completed is distinct from old.date_completed
      or new.photo_link is distinct from old.photo_link
      or new.photo_name is distinct from old.photo_name
      or new.spec is distinct from old.spec
      or new.match is distinct from old.match
      or old.evaluated_at is null
    );
  end if;
  if evaluation_event then
    new.evaluated_at:=case
      when tg_op='UPDATE' and new.date_completed is distinct from old.date_completed
        and new.date_completed is not null then new.date_completed
      when tg_op='INSERT' and new.date_completed is not null then new.date_completed
      else clock_timestamp()
    end;
    new.date_completed:=new.evaluated_at;
    new.baseline_on_hand:=current_on_hand;
    new.loc_match_pct:=private.inventory_location_evidence_number_v2(new.match);
    new.initial_photo_match_qty:=case
      when new.baseline_on_hand is not null and new.loc_match_pct between 0 and 100
        then round(new.baseline_on_hand*new.loc_match_pct/100)
      else null
    end;
    new.current_photo_match_qty:=private.inventory_location_evidence_qty_v2(
      new.baseline_on_hand,new.initial_photo_match_qty,current_on_hand
    );
    new.loc_match_qty:=new.current_photo_match_qty::text;
    new.initial_ptr:=coalesce(new.baseline_on_hand::text,new.initial_ptr);
    new.expires_at:=private.inventory_location_evidence_expiry_v2(new.evaluated_at);
    new.cleared_at:=null;
    new.clear_reason:=null;
  elsif new.evaluated_at is not null then
    new.current_photo_match_qty:=coalesce(
      private.inventory_location_evidence_qty_v2(
        new.baseline_on_hand,new.initial_photo_match_qty,current_on_hand
      ),new.current_photo_match_qty
    );
    new.loc_match_qty:=new.current_photo_match_qty::text;
  end if;
  if new.cleared_at is not null
    or (new.initial_photo_match_qty>0 and coalesce(new.current_photo_match_qty,0)<=0)
    or (new.expires_at is not null and clock_timestamp()>new.expires_at) then
    new.spec:=null;new.match:=null;new.loc_match_qty:=null;new.av_note:=null;
    new.pic_note:=null;new.sales_note:=null;new.photo_link:=null;new.photo_name:=null;
    new.date_completed:=null;
    if new.cleared_at is null then new.cleared_at:=clock_timestamp(); end if;
    if new.clear_reason is null then
      new.clear_reason:=case when new.expires_at is not null and clock_timestamp()>new.expires_at
        then 'expired' else 'depleted' end;
    end if;
  end if;
  return new;
end
$fn$;
revoke all on function private.normalize_inventory_location_evidence_v2() from public,anon,authenticated;
drop trigger if exists inventory_location_evidence_lifecycle_v2 on app_sync_private.inventory_location_evidence_v1;
create trigger inventory_location_evidence_lifecycle_v2
before insert or update on app_sync_private.inventory_location_evidence_v1
for each row execute function private.normalize_inventory_location_evidence_v2();

create or replace function private.apply_inventory_location_evidence_v1()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare
  evidence app_sync_private.inventory_location_evidence_v1%rowtype;
  evidence_changed boolean:=false;
  source_row boolean:=false;
  current_qty numeric;
  active_evidence boolean:=false;
  guard_enabled boolean:=current_setting('gnc.inventory_location_evidence_apply',true)='on';
begin
  if nullif(btrim(coalesce(new.itemcode,'')),'') is null
    or nullif(btrim(coalesce(new.locationcode,'')),'') is null then return new; end if;
  if tg_op='UPDATE' and not guard_enabled then
    evidence_changed:=(new.spec,new.caliper,new.match,new.loc_match_qty,new.initial_ptr,new.av_note,
      new.pic_note,new.sales_note,new.photo_link,new.photo_name,new.date_completed,new.app_tab_assignment)
      is distinct from
      (old.spec,old.caliper,old.match,old.loc_match_qty,old.initial_ptr,old.av_note,
      old.pic_note,old.sales_note,old.photo_link,old.photo_name,old.date_completed,old.app_tab_assignment);
    if private.ph_master_inventory_import_run_v1() is null and evidence_changed then return new; end if;
  end if;
  select * into evidence from app_sync_private.inventory_location_evidence_v1 e
  where e.itemcode_key=upper(btrim(new.itemcode)) and e.locationcode_key=upper(btrim(new.locationcode));
  if not found then return new; end if;
  source_row:=new.unique_id=evidence.source_unique_id
    or upper(btrim(coalesce(new.lotcode,'')))=upper(btrim(coalesce(evidence.source_lotcode,'')));
  current_qty:=evidence.current_photo_match_qty;
  if source_row then
    current_qty:=coalesce(private.inventory_location_evidence_qty_v2(
      evidence.baseline_on_hand,evidence.initial_photo_match_qty,
      private.inventory_location_evidence_number_v2(new.ptronhand)
    ),current_qty);
  end if;
  active_evidence:=evidence.cleared_at is null
    and (evidence.expires_at is null or clock_timestamp()<=evidence.expires_at)
    and (evidence.initial_photo_match_qty is null or evidence.initial_photo_match_qty<=0 or coalesce(current_qty,0)>0);
  new.spec:=case when active_evidence then evidence.spec else null end;
  new.caliper:=evidence.caliper;
  new.match:=case when active_evidence then evidence.match else null end;
  new.loc_match_qty:=case when not active_evidence then null when source_row then current_qty::text
    else private.inventory_location_match_qty_v1(new.ptronhand,evidence.match,evidence.loc_match_qty) end;
  new.initial_ptr:=evidence.initial_ptr;
  new.av_note:=case when active_evidence then evidence.av_note else null end;
  new.pic_note:=case when active_evidence then evidence.pic_note else null end;
  new.sales_note:=case when active_evidence then evidence.sales_note else null end;
  new.photo_link:=case when active_evidence then evidence.photo_link else null end;
  new.photo_name:=case when active_evidence then evidence.photo_name else null end;
  new.date_completed:=case when active_evidence then evidence.date_completed else null end;
  new.app_tab_assignment:=evidence.app_tab_assignment;
  return new;
end
$fn$;

create or replace function private.capture_inventory_location_evidence_v1()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare
  previous_guard text:=coalesce(current_setting('gnc.inventory_location_evidence_apply',true),'');
  actor text:=coalesce(nullif(current_setting('gnc.inventory_edit_actor',true),''),auth.uid()::text,'system');
  evidence app_sync_private.inventory_location_evidence_v1%rowtype;
begin
  if private.ph_master_inventory_import_run_v1() is not null or previous_guard='on' then return new; end if;
  if (new.spec,new.caliper,new.match,new.loc_match_qty,new.initial_ptr,new.av_note,
      new.pic_note,new.sales_note,new.photo_link,new.photo_name,new.date_completed,new.app_tab_assignment)
    is not distinct from
    (old.spec,old.caliper,old.match,old.loc_match_qty,old.initial_ptr,old.av_note,
      old.pic_note,old.sales_note,old.photo_link,old.photo_name,old.date_completed,old.app_tab_assignment) then return new; end if;
  insert into app_sync_private.inventory_location_evidence_v1 as stored(
    itemcode_key,locationcode_key,itemcode,locationcode,source_unique_id,
    spec,caliper,match,loc_match_qty,initial_ptr,av_note,pic_note,sales_note,
    photo_link,photo_name,date_completed,app_tab_assignment,updated_at,updated_by
  ) values(
    upper(btrim(new.itemcode)),upper(btrim(new.locationcode)),new.itemcode,new.locationcode,new.unique_id,
    new.spec,new.caliper,new.match,new.loc_match_qty,new.initial_ptr,new.av_note,new.pic_note,new.sales_note,
    new.photo_link,new.photo_name,new.date_completed,new.app_tab_assignment,clock_timestamp(),actor
  ) on conflict(itemcode_key,locationcode_key) do update set
    itemcode=excluded.itemcode,locationcode=excluded.locationcode,source_unique_id=excluded.source_unique_id,
    spec=excluded.spec,caliper=excluded.caliper,match=excluded.match,loc_match_qty=excluded.loc_match_qty,
    initial_ptr=excluded.initial_ptr,av_note=excluded.av_note,pic_note=excluded.pic_note,sales_note=excluded.sales_note,
    photo_link=excluded.photo_link,photo_name=excluded.photo_name,date_completed=excluded.date_completed,
    app_tab_assignment=excluded.app_tab_assignment,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  select * into evidence from app_sync_private.inventory_location_evidence_v1 e
  where e.itemcode_key=upper(btrim(new.itemcode)) and e.locationcode_key=upper(btrim(new.locationcode));
  perform set_config('gnc.inventory_location_evidence_apply','on',true);
  update public.ph_master_inventory m set
    spec=evidence.spec,caliper=evidence.caliper,match=evidence.match,
    loc_match_qty=case when evidence.cleared_at is not null then null
      when m.unique_id=evidence.source_unique_id
        or upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(evidence.source_lotcode,'')))
        then evidence.current_photo_match_qty::text
      else private.inventory_location_match_qty_v1(m.ptronhand,evidence.match,evidence.loc_match_qty) end,
    initial_ptr=evidence.initial_ptr,av_note=evidence.av_note,pic_note=evidence.pic_note,
    sales_note=evidence.sales_note,photo_link=evidence.photo_link,photo_name=evidence.photo_name,
    date_completed=evidence.date_completed,app_tab_assignment=evidence.app_tab_assignment,
    last_updated=greatest(m.last_updated,new.last_updated,evidence.updated_at)
  where upper(btrim(m.itemcode))=evidence.itemcode_key
    and upper(btrim(m.locationcode))=evidence.locationcode_key;
  perform set_config('gnc.inventory_location_evidence_apply',previous_guard,true);
  return new;
end
$fn$;

create or replace function public.reconcile_inventory_location_evidence_v1()
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='500ms' set statement_timeout='5s' as $fn$
declare
  affected integer:=0;
  evidence_updated integer:=0;
  previous_guard text:=coalesce(current_setting('gnc.inventory_location_evidence_apply',true),'');
begin
  with resolved as (
    select e.itemcode_key,e.locationcode_key,m.unique_id source_unique_id,m.lotcode source_lotcode,
      private.inventory_location_evidence_number_v2(m.ptronhand) current_on_hand
    from app_sync_private.inventory_location_evidence_v1 e
    left join lateral (
      select m.* from public.ph_master_inventory m
      where upper(btrim(m.itemcode))=e.itemcode_key and upper(btrim(m.locationcode))=e.locationcode_key
      order by (m.unique_id=e.source_unique_id) desc,
        (upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(e.source_lotcode,'')))) desc,
        m.last_updated desc nulls last,m.unique_id limit 1
    ) m on true
  ), calculated as (
    select e.itemcode_key,e.locationcode_key,r.source_unique_id,r.source_lotcode,
      coalesce(private.inventory_location_evidence_qty_v2(
        e.baseline_on_hand,e.initial_photo_match_qty,r.current_on_hand
      ),e.current_photo_match_qty) current_photo_match_qty,
      e.cleared_at is not null
        or (e.initial_photo_match_qty>0 and coalesce(private.inventory_location_evidence_qty_v2(
          e.baseline_on_hand,e.initial_photo_match_qty,r.current_on_hand
        ),e.current_photo_match_qty,0)<=0)
        or (e.expires_at is not null and clock_timestamp()>e.expires_at) must_clear,
      case when e.clear_reason is not null then e.clear_reason
        when e.expires_at is not null and clock_timestamp()>e.expires_at then 'expired'
        when e.initial_photo_match_qty>0 and coalesce(private.inventory_location_evidence_qty_v2(
          e.baseline_on_hand,e.initial_photo_match_qty,r.current_on_hand
        ),e.current_photo_match_qty,0)<=0 then 'depleted' end clear_reason
    from app_sync_private.inventory_location_evidence_v1 e
    join resolved r using(itemcode_key,locationcode_key)
  )
  update app_sync_private.inventory_location_evidence_v1 e set
    source_unique_id=coalesce(c.source_unique_id,e.source_unique_id),
    source_lotcode=coalesce(c.source_lotcode,e.source_lotcode),
    current_photo_match_qty=c.current_photo_match_qty,
    loc_match_qty=case when c.must_clear then null else c.current_photo_match_qty::text end,
    spec=case when c.must_clear then null else e.spec end,
    match=case when c.must_clear then null else e.match end,
    av_note=case when c.must_clear then null else e.av_note end,
    pic_note=case when c.must_clear then null else e.pic_note end,
    sales_note=case when c.must_clear then null else e.sales_note end,
    photo_link=case when c.must_clear then null else e.photo_link end,
    photo_name=case when c.must_clear then null else e.photo_name end,
    date_completed=case when c.must_clear then null else e.date_completed end,
    cleared_at=case when c.must_clear then coalesce(e.cleared_at,clock_timestamp()) else null end,
    clear_reason=case when c.must_clear then c.clear_reason else null end,
    updated_at=clock_timestamp()
  from calculated c
  where e.itemcode_key=c.itemcode_key and e.locationcode_key=c.locationcode_key
    and (e.source_unique_id,e.source_lotcode,e.current_photo_match_qty,e.loc_match_qty,e.spec,e.match,
      e.av_note,e.pic_note,e.sales_note,e.photo_link,e.photo_name,e.date_completed,e.cleared_at,e.clear_reason)
      is distinct from
      (coalesce(c.source_unique_id,e.source_unique_id),coalesce(c.source_lotcode,e.source_lotcode),
      c.current_photo_match_qty,case when c.must_clear then null else c.current_photo_match_qty::text end,
      case when c.must_clear then null else e.spec end,case when c.must_clear then null else e.match end,
      case when c.must_clear then null else e.av_note end,case when c.must_clear then null else e.pic_note end,
      case when c.must_clear then null else e.sales_note end,case when c.must_clear then null else e.photo_link end,
      case when c.must_clear then null else e.photo_name end,case when c.must_clear then null else e.date_completed end,
      case when c.must_clear then coalesce(e.cleared_at,clock_timestamp()) else null end,
      case when c.must_clear then c.clear_reason else null end);
  get diagnostics evidence_updated=row_count;
  perform set_config('gnc.inventory_location_evidence_apply','on',true);
  with desired as (
    select m.unique_id,e.spec,e.caliper,e.match,e.initial_ptr,e.av_note,e.pic_note,e.sales_note,
      e.photo_link,e.photo_name,e.date_completed,e.app_tab_assignment,e.updated_at,
      case when e.cleared_at is not null then null
        when m.unique_id=e.source_unique_id
          or upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(e.source_lotcode,'')))
          then e.current_photo_match_qty::text
        else private.inventory_location_match_qty_v1(m.ptronhand,e.match,e.loc_match_qty) end loc_match_qty
    from public.ph_master_inventory m
    join app_sync_private.inventory_location_evidence_v1 e
      on e.itemcode_key=upper(btrim(m.itemcode)) and e.locationcode_key=upper(btrim(m.locationcode))
  )
  update public.ph_master_inventory m set
    spec=d.spec,caliper=d.caliper,match=d.match,loc_match_qty=d.loc_match_qty,
    initial_ptr=d.initial_ptr,av_note=d.av_note,pic_note=d.pic_note,sales_note=d.sales_note,
    photo_link=d.photo_link,photo_name=d.photo_name,date_completed=d.date_completed,
    app_tab_assignment=d.app_tab_assignment,last_updated=greatest(m.last_updated,d.updated_at)
  from desired d
  where m.unique_id=d.unique_id
    and (m.spec,m.caliper,m.match,m.loc_match_qty,m.initial_ptr,m.av_note,m.pic_note,m.sales_note,
      m.photo_link,m.photo_name,m.date_completed,m.app_tab_assignment) is distinct from
      (d.spec,d.caliper,d.match,d.loc_match_qty,d.initial_ptr,d.av_note,d.pic_note,d.sales_note,
      d.photo_link,d.photo_name,d.date_completed,d.app_tab_assignment);
  get diagnostics affected=row_count;
  perform set_config('gnc.inventory_location_evidence_apply',previous_guard,true);
  return jsonb_build_object('ok',true,'affected',affected,'evidenceUpdated',evidence_updated,
    'cleared',(select count(*) from app_sync_private.inventory_location_evidence_v1 where cleared_at is not null));
end
$fn$;
revoke all on function private.apply_inventory_location_evidence_v1() from public,anon,authenticated;
revoke all on function private.capture_inventory_location_evidence_v1() from public,anon,authenticated;
revoke all on function public.reconcile_inventory_location_evidence_v1() from public,anon,authenticated;
grant execute on function public.reconcile_inventory_location_evidence_v1() to service_role;

do $fn$
declare existing_job bigint;
begin
  if to_regclass('cron.job') is not null and to_regprocedure('cron.schedule(text,text,text)') is not null then
    execute 'select jobid from cron.job where jobname=$1 limit 1'
      into existing_job using 'inventory_location_evidence_lifecycle_v2';
    if existing_job is not null then execute 'select cron.unschedule($1)' using existing_job; end if;
    execute 'select cron.schedule($1,$2,$3)' using
      'inventory_location_evidence_lifecycle_v2','* * * * *',
      'select public.reconcile_inventory_location_evidence_v1();';
  end if;
exception when others then null;
end
$fn$;

select public.reconcile_inventory_location_evidence_v1();
commit;
