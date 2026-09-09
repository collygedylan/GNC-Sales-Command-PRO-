-- Disposable CI/PGlite ONLY. This legacy trigger exists in production but
-- predates the checked-in migration history. Preserve its real reset behavior
-- so the new migration is tested against the deployed dependency.
create or replace function public.check_inventory_changes_and_reset()
returns trigger language plpgsql as $$
declare
  needs_reset boolean := false;
  old_hold varchar;
  new_hold varchar;
begin
  if old.priority is distinct from new.priority then needs_reset := true; end if;
  old_hold := upper(coalesce(old.holdstopcode, ''));
  new_hold := upper(coalesce(new.holdstopcode, ''));
  if (old_hold not similar to '%(H|S)%' and new_hold similar to '%(H|S)%') or
     (old_hold similar to '%(H|S)%' and new_hold not similar to '%(H|S)%') then
    needs_reset := true;
  end if;
  if needs_reset then
    new.av_note := null;
    new.spec := null;
    new.caliper := null;
    new.photo_link := null;
    new.photo_name := null;
    new.match := null;
    new.loc_match_qty := null;
    new.initial_ptr := null;
    new.date_completed := null;
  end if;
  return new;
end;
$$;
create trigger trigger_inventory_changes before update on public.ph_master_inventory
for each row execute function public.check_inventory_changes_and_reset();
