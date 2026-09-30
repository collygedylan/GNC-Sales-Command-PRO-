begin;
create or replace function private.item_inquiry_coverage_operation_v1(
  p_away boolean default null, p_expected_revision bigint default null, p_idempotency_key text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := auth.uid();
  actor_username text;
  s public.ph_item_inquiry_coverage;
  saved private.item_inquiry_coverage_audit;
  result jsonb;
  previous_away boolean;
begin
  if not private.can_manage_item_inquiry_coverage_v1() then
    raise exception using errcode='42501',message='ITEM_INQUIRY_COVERAGE_FORBIDDEN';
  end if;
  if p_away is not null then
    if p_expected_revision is null or p_expected_revision < 1
      or length(coalesce(p_idempotency_key,'')) not between 12 and 180 then
      raise exception using errcode='22023',message='ITEM_INQUIRY_COVERAGE_INVALID';
    end if;
    select * into s from public.ph_item_inquiry_coverage where singleton for update;
    select * into saved from private.item_inquiry_coverage_audit
      where item_inquiry_coverage_audit.actor_id=v_actor_id
        and item_inquiry_coverage_audit.idempotency_key=p_idempotency_key;
    if saved.id is not null then
      if saved.requested_away is distinct from p_away or saved.expected_revision <> p_expected_revision then
        raise exception using errcode='22023',message='ITEM_INQUIRY_COVERAGE_TOKEN_CONFLICT';
      end if;
      return saved.result || jsonb_build_object('replayed',true);
    end if;
    if s.revision <> p_expected_revision then
      raise exception using errcode='40001',message='ITEM_INQUIRY_COVERAGE_STALE';
    end if;
    if p_away and private.item_inquiry_verified_email_v1('sunday_ellis') is null then
      raise exception using errcode='40001',message='ITEM_INQUIRY_COVERAGE_UNAVAILABLE';
    end if;
    previous_away := s.sharon_away;
    select lower(btrim(username)) into actor_username from public.profiles where id=v_actor_id;
    if s.sharon_away is distinct from p_away then
      update public.ph_item_inquiry_coverage set sharon_away=p_away,revision=revision+1,
        updated_by=actor_username,updated_at=now() where singleton returning * into s;
    end if;
  else
    select * into s from public.ph_item_inquiry_coverage where singleton;
  end if;
  result := jsonb_build_object('ok',true,'sharonAway',s.sharon_away,'revision',s.revision,
    'updatedBy',s.updated_by,'updatedAt',s.updated_at,
    'backupReady',private.item_inquiry_verified_email_v1('sunday_ellis') is not null);
  if p_away is not null then
    insert into private.item_inquiry_coverage_audit
      (actor_id,idempotency_key,requested_away,expected_revision,previous_away,result)
    values(v_actor_id,p_idempotency_key,p_away,p_expected_revision,previous_away,result);
  end if;
  return result;
end
$$;
revoke all on function private.item_inquiry_coverage_operation_v1(boolean,bigint,text) from public, anon;
grant execute on function private.item_inquiry_coverage_operation_v1(boolean,bigint,text) to authenticated;
commit;
