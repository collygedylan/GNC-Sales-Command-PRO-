-- Match the browser's whitespace normalization at server authorization boundaries.
-- Stored profile data, account identities and permission grants are unchanged.
begin;
create or replace function sales_private.actor(p_id uuid)
returns public.profiles language plpgsql stable security definer set search_path='' as $function$
declare p public.profiles;
begin
  select * into p from public.profiles where id=p_id and disabled_at is null and not must_change_password
    and (locked_until is null or locked_until<=now());
  if p.id is null then raise exception using errcode='42501',message='SALES_ACTOR_NOT_ACTIVE'; end if;
  p.role:=regexp_replace(p.role,'^[[:space:]]+|[[:space:]]+$','','g');
  return p;
end;
$function$;

create or replace function sales_private.request_mapping_rep_allowed_v1(p_actor_id uuid, p_salesrep_id text)
returns boolean language sql stable security definer set search_path = '' as $function$
  select exists (
    select 1 from public.profiles actor
    where actor.id=p_actor_id and actor.disabled_at is null and not actor.must_change_password
      and (actor.locked_until is null or actor.locked_until<=clock_timestamp())
      and (
        (upper(regexp_replace(actor.role,'^[[:space:]]+|[[:space:]]+$','','g')) not in ('REP','SALESREP','SALES')
          and actor.username not in ('ben_brown','chance_alldredge'))
        or exists(select 1 from sales_private.rep_identities identity
          where identity.kind='external_id' and identity.identity_key=sales_private.key(p_salesrep_id)
            and identity.profile_id=actor.id)
      )
  )
$function$;
revoke all on function sales_private.actor(uuid) from public,anon,authenticated;
revoke all on function sales_private.request_mapping_rep_allowed_v1(uuid,text) from public,anon,authenticated;
grant execute on function sales_private.actor(uuid) to service_role;
grant execute on function sales_private.request_mapping_rep_allowed_v1(uuid,text) to service_role;
commit;
