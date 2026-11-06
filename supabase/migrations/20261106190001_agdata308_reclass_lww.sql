BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '15s';
-- AgData v3.0.8: authorized Reclass edits use current locked rows and last-write-wins.
-- Existing role/assignment checks, positive move quantity, explanation, command replay,
-- stock publication and durable outbox transactions remain in their canonical functions.
DO $patch$
DECLARE target record; source text; changed text;
BEGIN
 FOR target IN SELECT * FROM (VALUES
  ('private.prepare_reclass_live_edits_v6(jsonb,text)', 'raise exception using errcode=''PT409'', message = ''DRIVE_RECLASS_V6_LIVE_EDIT_CONFLICT'';'),
  ('private.apply_reclass_editable_fields_v7(jsonb,text,text)', 'raise exception using errcode=''PT409'',message=''DRIVE_RECLASS_V7_FIELD_CONFLICT'';'),
  ('private.prepare_reclass_editable_fields_v7(jsonb,text)', 'raise exception using errcode=''PT409'',message=''DRIVE_RECLASS_V7_ROW_IDENTITY_CONFLICT'';'),
  ('private.prepare_reclass_editable_fields_v7(jsonb,text)', 'raise exception using errcode=''PT409'',message=''DRIVE_RECLASS_V7_FIELD_CONFLICT'';'),
  ('private.validate_drive_reclass_sheared_v5(jsonb)', 'raise exception using errcode=''PT409'', message = ''DRIVE_RECLASS_V5_ORIGINAL_SNAPSHOT_CONFLICT'';'),
  ('public.apply_inventory_reclass_move_v1(uuid,text,bigint,text,jsonb,jsonb)', 'raise exception using errcode=''PT409'', message = ''INVENTORY_RECLASS_REVISION_CONFLICT'';')
 ) AS patches(signature, old_statement)
 LOOP
  source := pg_get_functiondef(target.signature::regprocedure);
  changed := replace(source, target.old_statement, 'NULL; /* agdata308_reclass_lww: retain current locked row */');
  IF changed = source AND position('agdata308_reclass_lww' in source)=0 THEN
   RAISE EXCEPTION 'AGDATA308_RECLASS_PATCH_ANCHOR_MISSING: %', target.signature;
  END IF;
  IF changed <> source THEN EXECUTE changed; END IF;
 END LOOP;
END $patch$;
COMMIT;
