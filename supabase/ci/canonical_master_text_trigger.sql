begin;
-- Replay the installed display-text trigger only in the disposable schema.
do $$ begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay') then
    raise exception 'CANONICAL_MASTER_TEXT_TRIGGER_REQUIRES_DISPOSABLE_SCHEMA_WORKSPACE';
  end if;
end $$;
CREATE OR REPLACE FUNCTION private.clean_ph_master_inventory_text_v23159()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ BEGIN NEW.commonname:=private.normalize_escaped_display_text_v1(NEW.commonname);
NEW.itemspec:=private.normalize_escaped_display_text_v1(NEW.itemspec);
NEW.spec:=private.normalize_escaped_display_text_v1(NEW.spec);
NEW.dock_spec:=private.normalize_escaped_display_text_v1(NEW.dock_spec);
NEW.dock_note:=private.normalize_escaped_display_text_v1(NEW.dock_note);
NEW.av_note:=private.normalize_escaped_display_text_v1(NEW.av_note);
NEW.pick_note:=private.normalize_escaped_display_text_v1(NEW.pick_note);
NEW.sales_note:=private.normalize_escaped_display_text_v1(NEW.sales_note);
NEW.caliper:=private.normalize_escaped_display_text_v1(NEW.caliper); RETURN NEW; END $function$;
CREATE TRIGGER v23159_clean_display_text BEFORE INSERT OR UPDATE OF commonname, itemspec, spec, dock_spec, dock_note, av_note, pick_note, sales_note, caliper ON public.ph_master_inventory FOR EACH ROW WHEN ((strpos(concat_ws(''::text, new.commonname, new.itemspec, new.spec, new.dock_spec, new.dock_note, new.av_note, new.pick_note, new.sales_note, new.caliper), (chr(92) || chr(39))) > 0)) EXECUTE FUNCTION private.clean_ph_master_inventory_text_v23159();
commit;
