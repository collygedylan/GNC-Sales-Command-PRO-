begin;
set local lock_timeout = '5s';

-- Normalize surrounding role whitespace without changing identity, overrides or stored profiles.
create or replace function private.navigation_module_allowed_v1(p_actor_id uuid, p_view text)
returns boolean language plpgsql stable set search_path=''
as $function$
declare p public.profiles; override_value boolean;
begin
  select * into p from public.profiles where id=p_actor_id;
  if p.id is null or p.disabled_at is not null or coalesce(p.must_change_password,false)
    or (p.locked_until is not null and p.locked_until>now()) then return false; end if;
  if not exists(select 1 from private.navigation_view_catalog where view_key=p_view) then return false; end if;
  if p_view in ('bunch-note','hl-order','disease-pest','pest-management') and lower(btrim(p.username))<>'dylan_collyge' then return false; end if;
  if p_view='managers' and lower(btrim(p.username))='brandt_emerson' then return false; end if;
  if p_view='access-control' then return private.navigation_is_manager_v1(p_actor_id); end if;
  if p_view='home' then return true; end if;
  -- This view is an immutable, server-scoped reporting capability. A user
  -- allow override must not grant it to managers or unrelated roles, while
  -- an explicit deny remains effective for an otherwise eligible account.
  if p_view='historical-requests' then
    select allowed into override_value from private.navigation_view_overrides where profile_id=p.id and view_key=p_view;
    if found and not override_value then return false; end if;
    return p.username='dylan_collyge'
      or upper(regexp_replace(coalesce(p.role,''),'^[[:space:]]+|[[:space:]]+$','','g')) in ('REP','SALESREP','ADMIN','ADMINISTRATOR');
  end if;
  select allowed into override_value from private.navigation_view_overrides where profile_id=p.id and view_key=p_view;
  if found then return override_value; end if;
  if p_view='reports' then return private.navigation_is_manager_v1(p_actor_id) or exists(select 1 from private.navigation_reports_legacy where profile_id=p.id); end if;
  if p_view like 'production:%' then return private.navigation_module_allowed_v1(p.id,'production-workflow'); end if;
  if p_view in ('request-history','sales-credit','credit-request') then
    return private.navigation_module_allowed_v1(p.id,'sales') or lower(btrim(p.username)) in ('dylan_collyge','jd_jones','megan_kelly');
  end if;
  if p_view='request' then return true; end if;
  return private.navigation_legacy_allowed_v1(p.id,p_view);
end
$function$;

commit;
