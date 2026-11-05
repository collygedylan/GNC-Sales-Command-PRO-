BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';

CREATE OR REPLACE FUNCTION public.test_fn_normalize_itemcode(raw_itemcode text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT rtrim(trim(coalesce(raw_itemcode,'')),'.') $$;
CREATE OR REPLACE FUNCTION test_private.ops_qty(v text) RETURNS integer LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE n numeric; BEGIN IF nullif(trim(v),'') IS NULL THEN RETURN 0; END IF; n:=replace(v,',','')::numeric; IF n<0 OR n<>trunc(n) OR n>2147483647 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF; RETURN n::integer; END $$;
CREATE OR REPLACE FUNCTION public.test_fn_can_team_pull_tag(team text, tag text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE upper(coalesce(nullif(trim(team),''),'BLANK')) WHEN 'ESP' THEN 2 WHEN 'SP' THEN 1 WHEN 'BLANK' THEN 0 ELSE -1 END >= CASE upper(coalesce(nullif(trim(tag),''),'BLANK')) WHEN 'ESP' THEN 2 WHEN 'SP' THEN 1 WHEN 'BLANK' THEN 0 ELSE 99 END
$$;
CREATE OR REPLACE FUNCTION test_private.ops_season_allowed(season text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT upper(trim(coalesce(season,''))) ~ '^(\d{2,4}\.)?(F1|S1)$' $$;

CREATE TABLE IF NOT EXISTS public.test_ph_pullers(puller_id text PRIMARY KEY CHECK(puller_id ~ '^0[0-7][0-9]$|^080$' AND puller_id<>'000'),puller_name text NOT NULL,first_name text,last_name text,quality_status text NOT NULL DEFAULT 'BLANK' CHECK(quality_status IN ('ESP','SP','BLANK')),is_active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.test_ph_pullers(puller_id,puller_name,first_name,last_name) SELECT lpad(n::text,3,'0'),'Test Puller '||lpad(n::text,3,'0'),'Test Puller',lpad(n::text,3,'0') FROM generate_series(1,80)n ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.test_ph_wingding_units(wingding_id text PRIMARY KEY CHECK(wingding_id::integer BETWEEN 200 AND 240),max_unit_capacity integer NOT NULL DEFAULT 600 CHECK(max_unit_capacity BETWEEN 500 AND 700),status text NOT NULL DEFAULT 'OPERATIONAL' CHECK(status IN ('OPERATIONAL','MAINTENANCE','DECOMMISSIONED')),updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.test_ph_wingding_units(wingding_id) SELECT n::text FROM generate_series(200,240)n ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.test_ph_order_pulling_teams(team_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),wingding_id text NOT NULL REFERENCES public.test_ph_wingding_units,driver_puller_id text NOT NULL REFERENCES public.test_ph_pullers,helper_puller_id text NOT NULL REFERENCES public.test_ph_pullers,team_quality text NOT NULL CHECK(team_quality IN ('ESP','SP','BLANK')),shift_date date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Chicago')::date,active_status boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),CHECK(driver_puller_id<>helper_puller_id));
CREATE UNIQUE INDEX IF NOT EXISTS test_ops_active_team_unit ON public.test_ph_order_pulling_teams(wingding_id,shift_date) WHERE active_status;

ALTER TABLE public.test_ph_soc_master ADD COLUMN IF NOT EXISTS soc_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS test_ops_soc_id ON public.test_ph_soc_master(soc_id);
ALTER TABLE public.test_ph_soc_master ADD COLUMN IF NOT EXISTS load_id text;
ALTER TABLE public.test_ph_soc_master ADD COLUMN IF NOT EXISTS drop_number integer NOT NULL DEFAULT 1;
ALTER TABLE public.test_ph_soc_master ADD COLUMN IF NOT EXISTS ordered_qty integer NOT NULL DEFAULT 0;
ALTER TABLE public.test_ph_soc_master ADD COLUMN IF NOT EXISTS shipped_qty integer NOT NULL DEFAULT 0;
ALTER TABLE public.test_ph_soc_master ADD COLUMN IF NOT EXISTS is_split_line boolean NOT NULL DEFAULT false;
ALTER TABLE public.test_ph_soc_master ADD COLUMN IF NOT EXISTS parent_soc_id uuid;
ALTER TABLE public.test_ph_soc_master ADD COLUMN IF NOT EXISTS is_rush_priority boolean NOT NULL DEFAULT false;
ALTER TABLE public.test_ph_soc_master ADD COLUMN IF NOT EXISTS tag_quality text NOT NULL DEFAULT 'BLANK';
ALTER TABLE public.test_ph_soc_master ADD COLUMN IF NOT EXISTS assigned_wingding_id text;
ALTER TABLE public.test_ph_soc_master ADD COLUMN IF NOT EXISTS assigned_qty integer NOT NULL DEFAULT 0;
ALTER TABLE public.test_ph_soc_master ADD COLUMN IF NOT EXISTS pulled_qty integer NOT NULL DEFAULT 0;
ALTER TABLE public.test_ph_soc_master ADD COLUMN IF NOT EXISTS verified_qty integer NOT NULL DEFAULT 0;
ALTER TABLE public.test_ph_soc_master ADD COLUMN IF NOT EXISTS mistake_qty integer NOT NULL DEFAULT 0;
ALTER TABLE public.test_ph_soc_master ADD COLUMN IF NOT EXISTS is_pink_tape boolean NOT NULL DEFAULT false;
ALTER TABLE public.test_ph_soc_master ADD COLUMN IF NOT EXISTS line_status text NOT NULL DEFAULT 'PENDING_PULL';
UPDATE public.test_ph_soc_master SET load_id=coalesce(nullif(tripnumber,''),nullif(transactionnumber,''),unique_id),ordered_qty=test_private.ops_qty(quantityordered),shipped_qty=test_private.ops_qty(quantityshipped),tag_quality=CASE upper(trim(coalesce(qualitycode,''))) WHEN 'ESP' THEN 'ESP' WHEN 'SP' THEN 'SP' ELSE 'BLANK' END WHERE load_id IS NULL;

CREATE TABLE IF NOT EXISTS public.test_ph_dock_drop_status(drop_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),load_id text NOT NULL,drop_number integer NOT NULL DEFAULT 1,dock_bay text,is_live_driver boolean NOT NULL DEFAULT false,driver_name text,trailer_seal_number text,driver_arrived_at timestamptz,driver_signoff_at timestamptz,driver_signature text,tagging_complete boolean NOT NULL DEFAULT false,total_items integer NOT NULL DEFAULT 0,checked_items integer NOT NULL DEFAULT 0,mistake_items integer NOT NULL DEFAULT 0,inspection_ready boolean NOT NULL DEFAULT false,palletization_alert_sent boolean NOT NULL DEFAULT false,loading_status text NOT NULL DEFAULT 'FIELD_PULLING',inspector_signoff_by text,inspector_signoff_at timestamptz,dispatched_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(load_id,drop_number),CHECK(total_items>=0 AND checked_items>=0 AND mistake_items>=0 AND checked_items+mistake_items<=total_items));
INSERT INTO public.test_ph_dock_drop_status(load_id,drop_number,dock_bay,total_items) SELECT load_id,drop_number,max(dock),sum(ordered_qty) FROM public.test_ph_soc_master GROUP BY load_id,drop_number ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.test_ph_docks(soc_id uuid PRIMARY KEY REFERENCES public.test_ph_soc_master(soc_id),load_id text NOT NULL,drop_number integer NOT NULL,locationcode text,ordered_qty integer NOT NULL,shipped_qty integer NOT NULL DEFAULT 0,line_status text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.test_ph_docks(soc_id,load_id,drop_number,locationcode,ordered_qty,shipped_qty,line_status) SELECT soc_id,load_id,drop_number,locationcode,ordered_qty,shipped_qty,line_status FROM public.test_ph_soc_master ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.test_ph_mistake_queue(mistake_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),soc_id uuid NOT NULL REFERENCES public.test_ph_soc_master(soc_id),itemcode text,common_name text,rejection_type text NOT NULL CHECK(rejection_type IN ('R-all','R-[N]')),rejected_qty integer NOT NULL CHECK(rejected_qty>0),bad_plant_photo_url text NOT NULL CHECK(length(trim(bad_plant_photo_url))>0),good_plant_photo_url text,old_location text NOT NULL,replacement_locations jsonb,season_code text,status text NOT NULL DEFAULT 'SUSPENDED',created_by uuid NOT NULL,resolved_by uuid,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),CHECK(rejection_type='R-all' OR length(trim(good_plant_photo_url))>0));
CREATE TABLE IF NOT EXISTS public.test_ph_hl_staging(staging_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bay integer NOT NULL CHECK(bay BETWEEN 1 AND 23),source_uid text NOT NULL,target_uid text NOT NULL,itemcode text NOT NULL,quantity integer NOT NULL CHECK(quantity>0),created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),released_at timestamptz);
CREATE TABLE IF NOT EXISTS public.test_ph_reclass_inquiries(inquiry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),itemcode text NOT NULL,common_name text,contsize text,lotcode text,old_location text,new_location text,quantity integer NOT NULL,actor_id uuid NOT NULL,puller_signature text NOT NULL,notes text,created_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE VIEW public.test_ph_customer_reserves WITH(security_invoker=true) AS SELECT * FROM public.test_ph_reserves;
CREATE TABLE IF NOT EXISTS test_private.ops_command_receipts(command_id uuid PRIMARY KEY,actor_id uuid NOT NULL,action text NOT NULL,request_hash text NOT NULL,receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS test_private.ops_outbox(event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_key text UNIQUE NOT NULL,payload jsonb NOT NULL,recipient text NOT NULL DEFAULT 'dylan_collyge@greenleafnursery.com' CHECK(recipient='dylan_collyge@greenleafnursery.com'),status text NOT NULL DEFAULT 'PENDING',attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),lease_token uuid,lease_until timestamptz,receipt jsonb,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.test_ph_request_delivery_outbox ADD COLUMN IF NOT EXISTS test_mail_eligible boolean NOT NULL DEFAULT false;
ALTER TABLE public.test_ph_request_delivery_outbox ALTER COLUMN test_mail_eligible SET DEFAULT true;

CREATE OR REPLACE FUNCTION test_private.trap_email_json(v jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; x jsonb; out jsonb; BEGIN
 IF jsonb_typeof(v)='object' THEN out:='{}'; FOR k,x IN SELECT * FROM jsonb_each(v) LOOP
  IF lower(replace(k,'_','')) IN ('to','cc','bcc','recipient','recipients','recipientemail','recipientemails','emailto','emailcc','emailbcc','replyto') THEN x:=CASE WHEN jsonb_typeof(x)='array' THEN '["dylan_collyge@greenleafnursery.com"]'::jsonb ELSE to_jsonb('dylan_collyge@greenleafnursery.com'::text) END; ELSE x:=test_private.trap_email_json(x); END IF;
  out:=out||jsonb_build_object(k,x); END LOOP; RETURN out;
 ELSIF jsonb_typeof(v)='array' THEN SELECT coalesce(jsonb_agg(test_private.trap_email_json(value)),'[]') INTO out FROM jsonb_array_elements(v); RETURN out; ELSE RETURN v; END IF;
END $$;
CREATE OR REPLACE FUNCTION test_private.trap_outbox_email() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.payload:=test_private.trap_email_json(NEW.payload)||jsonb_build_object('test_recipient','dylan_collyge@greenleafnursery.com','test_environment',true); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS test_email_trap ON public.test_ph_request_delivery_outbox;
CREATE TRIGGER test_email_trap BEFORE INSERT OR UPDATE ON public.test_ph_request_delivery_outbox FOR EACH ROW EXECUTE FUNCTION test_private.trap_outbox_email();
UPDATE public.test_ph_request_delivery_outbox SET payload=test_private.trap_email_json(payload) WHERE NOT test_mail_eligible;
DROP TRIGGER IF EXISTS test_email_trap ON test_private.ops_outbox;
CREATE TRIGGER test_email_trap BEFORE INSERT OR UPDATE ON test_private.ops_outbox FOR EACH ROW EXECUTE FUNCTION test_private.trap_outbox_email();

CREATE OR REPLACE FUNCTION public.test_fn_evaluate_drop_thresholds() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 NEW.inspection_ready:=NEW.total_items>0 AND NEW.checked_items::bigint*10>=NEW.total_items;
 NEW.palletization_alert_sent:=NEW.total_items>0 AND NEW.checked_items::bigint*100>=NEW.total_items::bigint*95 AND NEW.checked_items+NEW.mistake_items=NEW.total_items;
 IF NEW.palletization_alert_sent AND NEW.loading_status IN ('FIELD_PULLING','DOCK_STAGING','TAGGING','CHECKER','READY_FOR_PALLETIZATION') THEN NEW.loading_status:='READY_FOR_PALLETIZATION';
 ELSIF NOT NEW.palletization_alert_sent AND NEW.loading_status='READY_FOR_PALLETIZATION' THEN NEW.loading_status:='CHECKER'; END IF;
 NEW.updated_at:=now(); RETURN NEW; END $$;
CREATE TRIGGER test_drop_thresholds BEFORE INSERT OR UPDATE ON public.test_ph_dock_drop_status FOR EACH ROW EXECUTE FUNCTION public.test_fn_evaluate_drop_thresholds();
CREATE OR REPLACE FUNCTION public.test_fn_elevate_live_driver() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.is_live_driver AND (TG_OP='INSERT' OR NOT OLD.is_live_driver OR OLD.load_id<>NEW.load_id) THEN UPDATE public.test_ph_soc_master SET is_rush_priority=true WHERE load_id=NEW.load_id AND line_status NOT IN ('SHIPPED','SUPERSEDED'); END IF; RETURN NEW; END $$;
CREATE TRIGGER test_elevate_live_driver AFTER INSERT OR UPDATE ON public.test_ph_dock_drop_status FOR EACH ROW EXECUTE FUNCTION public.test_fn_elevate_live_driver();
CREATE OR REPLACE FUNCTION test_private.sync_ops_line() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM public.test_ph_dock_drop_status WHERE load_id=NEW.load_id AND is_live_driver AND dispatched_at IS NULL) THEN NEW.is_rush_priority:=true; END IF;
 IF NEW.ordered_qty<0 OR NEW.shipped_qty<0 OR NEW.pulled_qty<0 OR NEW.verified_qty<0 OR NEW.mistake_qty<0 OR NEW.shipped_qty>NEW.ordered_qty OR NEW.verified_qty+NEW.mistake_qty>NEW.ordered_qty THEN RAISE EXCEPTION 'INVALID_LINE_QUANTITIES'; END IF;
 IF NEW.is_pink_tape AND (NEW.shipped_qty>0 OR NEW.verified_qty>0) THEN RAISE EXCEPTION 'PINK_TAPE_ISOLATION'; END IF; RETURN NEW; END $$;
CREATE TRIGGER test_ops_line_guard BEFORE INSERT OR UPDATE ON public.test_ph_soc_master FOR EACH ROW EXECUTE FUNCTION test_private.sync_ops_line();
CREATE OR REPLACE FUNCTION test_private.refresh_ops_drop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO public.test_ph_docks(soc_id,load_id,drop_number,locationcode,ordered_qty,shipped_qty,line_status) VALUES(NEW.soc_id,NEW.load_id,NEW.drop_number,NEW.locationcode,NEW.ordered_qty,NEW.shipped_qty,NEW.line_status) ON CONFLICT(soc_id) DO UPDATE SET load_id=EXCLUDED.load_id,drop_number=EXCLUDED.drop_number,locationcode=EXCLUDED.locationcode,ordered_qty=EXCLUDED.ordered_qty,shipped_qty=EXCLUDED.shipped_qty,line_status=EXCLUDED.line_status,updated_at=now();
 INSERT INTO public.test_ph_dock_drop_status(load_id,drop_number) VALUES(NEW.load_id,NEW.drop_number) ON CONFLICT(load_id,drop_number) DO NOTHING;
 UPDATE public.test_ph_dock_drop_status d SET total_items=a.total,checked_items=a.checked,mistake_items=a.mistakes FROM (SELECT coalesce(sum(ordered_qty),0)::integer total,coalesce(sum(verified_qty),0)::integer checked,coalesce(sum(mistake_qty),0)::integer mistakes FROM public.test_ph_soc_master WHERE load_id=NEW.load_id AND drop_number=NEW.drop_number AND line_status<>'SUPERSEDED')a WHERE d.load_id=NEW.load_id AND d.drop_number=NEW.drop_number; RETURN NEW; END $$;
CREATE TRIGGER test_ops_drop_refresh AFTER INSERT OR UPDATE OF ordered_qty,verified_qty,mistake_qty,shipped_qty,locationcode,line_status ON public.test_ph_soc_master FOR EACH ROW EXECUTE FUNCTION test_private.refresh_ops_drop();

CREATE OR REPLACE FUNCTION test_private.ops_clone_soc(source_row public.test_ph_soc_master,patch jsonb) RETURNS public.test_ph_soc_master LANGUAGE plpgsql SET search_path=pg_catalog,public,test_private AS $$
DECLARE fields text; result public.test_ph_soc_master; BEGIN SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO fields FROM pg_attribute WHERE attrelid='public.test_ph_soc_master'::regclass AND attnum>0 AND NOT attisdropped AND attgenerated=''; EXECUTE format('INSERT INTO public.test_ph_soc_master(%s) SELECT %s FROM jsonb_populate_record(NULL::public.test_ph_soc_master,$1) RETURNING *',fields,fields) INTO result USING to_jsonb(source_row)||patch; RETURN result; END $$;
CREATE OR REPLACE FUNCTION test_private.ops_photo_valid(url text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,storage AS $$ SELECT url LIKE 'https://apztnscvagayslumnalr.supabase.co/storage/v1/object/public/farm-operations-staging/%' AND EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='farm-operations-staging' AND name=substring(url from '/farm-operations-staging/(.*)$')) $$;

CREATE OR REPLACE FUNCTION test_private.ops_read_qty(v text) RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN RETURN coalesce(nullif(replace(trim(v),',',''),''),'0')::numeric; EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION public.test_ops_inventory(item text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,test_private AS $$
DECLARE p public.test_profiles; result jsonb; key text:=public.test_fn_normalize_itemcode(item); BEGIN p:=test_private.current_profile(); IF p.id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('row_uid',unique_id,'itemcode',itemcode,'commonname',commonname,'contsize',contsize,'locationcode',locationcode,'lotcode',lotcode,'season',season,'available',test_private.ops_read_qty(ptravailable),'onhand',test_private.ops_read_qty(ptronhand),'priority',priority)),'[]') INTO result FROM (SELECT * FROM public.test_ph_master_inventory WHERE public.test_fn_normalize_itemcode(itemcode)=key OR public.test_fn_normalize_itemcode(itemcode) LIKE key||'.%' ORDER BY itemcode,locationcode,lotcode,unique_id LIMIT 500)t; RETURN result; END $$;

CREATE OR REPLACE FUNCTION public.test_ops_snapshot() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,test_private AS $$
DECLARE p public.test_profiles; BEGIN p:=test_private.current_profile();IF p.id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('actor',jsonb_build_object('id',p.id,'username',p.username,'role',p.role),'pullers',(SELECT coalesce(jsonb_agg(t ORDER BY puller_id),'[]') FROM public.test_ph_pullers t),'units',(SELECT jsonb_agg(t ORDER BY wingding_id) FROM public.test_ph_wingding_units t),'teams',(SELECT coalesce(jsonb_agg(t),'[]') FROM public.test_ph_order_pulling_teams t WHERE active_status),'lines',(SELECT coalesce(jsonb_agg(t),'[]') FROM (SELECT soc_id,unique_id,itemcode,commonname,contsize,locationcode,lotcode,season,load_id,drop_number,dock,planstart,ordered_qty,shipped_qty,pulled_qty,verified_qty,mistake_qty,assigned_qty,assigned_wingding_id,tag_quality,is_rush_priority,is_pink_tape,line_status,is_split_line,parent_soc_id FROM public.test_ph_soc_master WHERE line_status<>'SUPERSEDED' ORDER BY is_rush_priority DESC,locationcode,unique_id LIMIT 2000)t),'drops',(SELECT coalesce(jsonb_agg(t),'[]') FROM public.test_ph_dock_drop_status t),'mistakes',(SELECT coalesce(jsonb_agg(t),'[]') FROM public.test_ph_mistake_queue t),'staging',(SELECT coalesce(jsonb_agg(t),'[]') FROM public.test_ph_hl_staging t WHERE released_at IS NULL),'captured_at',now()); END $$;

CREATE OR REPLACE FUNCTION public.test_ops_command(command_id uuid,command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,test_private AS $$
DECLARE p public.test_profiles; action text:=command->>'action'; old_receipt test_private.ops_command_receipts; request_hash text:=md5(command::text); result jsonb:='{}';
 team public.test_ph_order_pulling_teams; unit public.test_ph_wingding_units; line public.test_ph_soc_master; child public.test_ph_soc_master; drop_row public.test_ph_dock_drop_status; master public.test_ph_master_inventory; target_row public.test_ph_master_inventory;
 d public.test_ph_pullers; h public.test_ph_pullers; alloc jsonb; quantity integer; remaining integer; total integer; family text; tier text; new_id uuid; stage public.test_ph_hl_staging; fields text; actor_role text; po_value jsonb; po_remaining numeric; deviation boolean:=false; planned_location text;
BEGIN
 p:=test_private.current_profile();IF p.id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501';END IF;
 actor_role:=lower(replace(coalesce(p.role,''),' ','_'));
 IF actor_role NOT IN ('admin','administrator','super_admin','super-admin','manager','qc','production','inspector','checker','dispatcher','puller','loading','tagging','eval','employee') AND lower(p.username) NOT IN ('dylan_collyge','tanner','jack','tyler') THEN RAISE EXCEPTION 'OPERATIONS_ROLE_REQUIRED' USING ERRCODE='42501';END IF;
 IF command_id IS NULL THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(command_id::text,31));
 SELECT * INTO old_receipt FROM test_private.ops_command_receipts WHERE ops_command_receipts.command_id=test_ops_command.command_id;
 IF FOUND THEN IF old_receipt.actor_id<>p.id OR old_receipt.request_hash<>request_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN old_receipt.receipt;END IF;
 IF action='puller_update' THEN
  IF actor_role NOT IN ('admin','administrator','super_admin','super-admin','manager') AND p.username<>'dylan_collyge' THEN RAISE EXCEPTION 'MANAGER_REQUIRED';END IF;
  tier:=upper(coalesce(nullif(command->>'quality',''),'BLANK'));IF tier NOT IN ('ESP','SP','BLANK') THEN RAISE EXCEPTION 'INVALID_QUALITY_TIER';END IF;
  IF EXISTS(SELECT 1 FROM public.test_ph_order_pulling_teams WHERE active_status AND (driver_puller_id=command->>'puller_id' OR helper_puller_id=command->>'puller_id')) THEN RAISE EXCEPTION 'END_ACTIVE_TEAM_BEFORE_QUALITY_CHANGE';END IF;
  UPDATE public.test_ph_pullers SET puller_name=coalesce(nullif(trim(command->>'name'),''),puller_name),quality_status=tier,updated_at=now() WHERE puller_id=command->>'puller_id';
 ELSIF action='team_checkin' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('test:team:'||(now() AT TIME ZONE 'America/Chicago')::date,31));
  SELECT * INTO d FROM public.test_ph_pullers WHERE puller_id=command->>'driver' AND is_active;SELECT * INTO h FROM public.test_ph_pullers WHERE puller_id=command->>'helper' AND is_active;
  IF d.puller_id IS NULL OR h.puller_id IS NULL OR d.puller_id=h.puller_id THEN RAISE EXCEPTION 'DISTINCT_ACTIVE_PULLERS_REQUIRED';END IF;
  SELECT * INTO unit FROM public.test_ph_wingding_units WHERE wingding_id=command->>'unit' FOR UPDATE;
  IF unit.wingding_id IS NULL OR unit.status<>'OPERATIONAL' THEN RAISE EXCEPTION 'UNIT_UNAVAILABLE';END IF;
  IF EXISTS(SELECT 1 FROM public.test_ph_order_pulling_teams WHERE active_status AND shift_date=(now() AT TIME ZONE 'America/Chicago')::date AND (wingding_id=unit.wingding_id OR driver_puller_id IN (d.puller_id,h.puller_id) OR helper_puller_id IN (d.puller_id,h.puller_id))) THEN RAISE EXCEPTION 'TEAM_MEMBER_OR_UNIT_ALREADY_ASSIGNED';END IF;
  tier:=CASE WHEN 'ESP' IN(d.quality_status,h.quality_status) THEN 'ESP' WHEN 'SP' IN(d.quality_status,h.quality_status) THEN 'SP' ELSE 'BLANK' END;
  INSERT INTO public.test_ph_order_pulling_teams(wingding_id,driver_puller_id,helper_puller_id,team_quality) VALUES(unit.wingding_id,d.puller_id,h.puller_id,tier) RETURNING * INTO team;result:=to_jsonb(team);
 ELSIF action='assign_pull' THEN
  SELECT * INTO team FROM public.test_ph_order_pulling_teams WHERE team_id=(command->>'team_id')::uuid AND active_status FOR UPDATE;SELECT * INTO unit FROM public.test_ph_wingding_units WHERE wingding_id=team.wingding_id FOR UPDATE;
  IF team.team_id IS NULL OR unit.status<>'OPERATIONAL' THEN RAISE EXCEPTION 'ACTIVE_OPERATIONAL_TEAM_REQUIRED';END IF;
  SELECT unit.max_unit_capacity-coalesce(sum(assigned_qty),0) INTO remaining FROM public.test_ph_soc_master WHERE assigned_wingding_id=unit.wingding_id;
  FOR line IN SELECT * FROM public.test_ph_soc_master WHERE soc_id IN(SELECT value::text::uuid FROM jsonb_array_elements_text(command->'soc_ids')) ORDER BY is_rush_priority DESC,substring(locationcode from '^[A-Za-z]+'),coalesce(nullif(substring(locationcode from '\.(\d+)'),''),'0')::integer,locationcode,unique_id FOR UPDATE LOOP
   IF NOT public.test_fn_can_team_pull_tag(team.team_quality,line.tag_quality) THEN RAISE EXCEPTION 'INSUFFICIENT_PULLER_QUALITY_TIER';END IF;
   IF line.assigned_qty>0 OR line.is_pink_tape OR line.line_status IN('SUPERSEDED','SHIPPED') THEN RAISE EXCEPTION 'LINE_UNAVAILABLE';END IF;
   quantity:=least(remaining,line.ordered_qty-line.pulled_qty);IF quantity>0 THEN UPDATE public.test_ph_soc_master SET assigned_wingding_id=unit.wingding_id,assigned_qty=quantity WHERE soc_id=line.soc_id;remaining:=remaining-quantity;END IF;
  END LOOP;result:=jsonb_build_object('remaining_capacity',remaining);
 ELSIF action='arrive_at_dock' THEN
  SELECT * INTO team FROM public.test_ph_order_pulling_teams WHERE team_id=(command->>'team_id')::uuid AND active_status FOR UPDATE;IF team.team_id IS NULL THEN RAISE EXCEPTION 'ACTIVE_TEAM_REQUIRED';END IF;
  UPDATE public.test_ph_soc_master SET pulled_qty=pulled_qty+assigned_qty,assigned_qty=0,line_status='STAGED_AT_DOCK' WHERE assigned_wingding_id=team.wingding_id AND assigned_qty>0 AND NOT is_pink_tape;
 ELSIF action='breakdown_swap' THEN
  IF lower(p.username) NOT IN('dylan_collyge','tanner','jack','tyler') THEN RAISE EXCEPTION 'BREAKDOWN_OVERRIDE_DENIED' USING ERRCODE='42501';END IF;
  SELECT * INTO team FROM public.test_ph_order_pulling_teams WHERE team_id=(command->>'team_id')::uuid AND active_status FOR UPDATE;IF team.team_id IS NULL THEN RAISE EXCEPTION 'ACTIVE_TEAM_REQUIRED';END IF;
  PERFORM 1 FROM public.test_ph_wingding_units WHERE wingding_id IN(team.wingding_id,command->>'replacement') ORDER BY wingding_id FOR UPDATE;
  SELECT * INTO unit FROM public.test_ph_wingding_units WHERE wingding_id=command->>'replacement';IF unit.status IS DISTINCT FROM 'OPERATIONAL' OR unit.wingding_id=team.wingding_id OR EXISTS(SELECT 1 FROM public.test_ph_order_pulling_teams WHERE active_status AND wingding_id=unit.wingding_id) THEN RAISE EXCEPTION 'REPLACEMENT_UNIT_UNAVAILABLE';END IF;
  UPDATE public.test_ph_wingding_units SET status='MAINTENANCE',updated_at=now() WHERE wingding_id=team.wingding_id;
  remaining:=unit.max_unit_capacity;FOR line IN SELECT * FROM public.test_ph_soc_master WHERE assigned_wingding_id=team.wingding_id ORDER BY is_rush_priority DESC,locationcode,unique_id FOR UPDATE LOOP quantity:=least(remaining,line.assigned_qty);UPDATE public.test_ph_soc_master SET assigned_wingding_id=CASE WHEN quantity>0 THEN unit.wingding_id ELSE NULL END,assigned_qty=quantity WHERE soc_id=line.soc_id;remaining:=remaining-quantity;END LOOP;
  UPDATE public.test_ph_order_pulling_teams SET wingding_id=unit.wingding_id WHERE team_id=team.team_id;result:=jsonb_build_object('replacement',unit.wingding_id,'remaining_capacity',remaining);
 ELSIF action='traffic_checkin' THEN
  IF NOT EXISTS(SELECT 1 FROM public.test_ph_soc_master WHERE load_id=command->>'load_id') OR nullif(trim(command->>'driver_name'),'') IS NULL THEN RAISE EXCEPTION 'LOAD_AND_DRIVER_REQUIRED';END IF;
  UPDATE public.test_ph_dock_drop_status SET driver_name=left(command->>'driver_name',120),is_live_driver=coalesce((command->>'is_live_driver')::boolean,false),dock_bay=left(command->>'dock',32),trailer_seal_number=left(command->>'seal',64),driver_arrived_at=coalesce(driver_arrived_at,now()) WHERE load_id=command->>'load_id' AND dispatched_at IS NULL;
 ELSIF action IN('dock_stage','tagging_complete','verify_line','load_drop','inspector_signoff','dispatch') THEN
  SELECT * INTO drop_row FROM public.test_ph_dock_drop_status WHERE drop_id=(command->>'drop_id')::uuid FOR UPDATE;IF drop_row.drop_id IS NULL OR drop_row.dispatched_at IS NOT NULL THEN RAISE EXCEPTION 'ACTIVE_DROP_REQUIRED';END IF;
  IF action='dock_stage' THEN
   IF command->>'stage' NOT IN('DOCK_STAGING','TAGGING') OR (command->>'stage'='DOCK_STAGING' AND drop_row.loading_status<>'FIELD_PULLING') OR (command->>'stage'='TAGGING' AND drop_row.loading_status<>'DOCK_STAGING') THEN RAISE EXCEPTION 'INVALID_STAGE_TRANSITION';END IF;
   IF NOT EXISTS(SELECT 1 FROM public.test_ph_soc_master WHERE load_id=drop_row.load_id AND drop_number=drop_row.drop_number AND pulled_qty>0) THEN RAISE EXCEPTION 'PULLED_EVIDENCE_REQUIRED';END IF;
   UPDATE public.test_ph_dock_drop_status SET loading_status=command->>'stage' WHERE drop_id=drop_row.drop_id;
  ELSIF action='tagging_complete' THEN
   IF drop_row.loading_status<>'TAGGING' OR EXISTS(SELECT 1 FROM public.test_ph_soc_master WHERE load_id=drop_row.load_id AND drop_number=drop_row.drop_number AND line_status<>'SUPERSEDED' AND pulled_qty+mistake_qty<ordered_qty) THEN RAISE EXCEPTION 'TAGGING_NOT_READY';END IF;
   UPDATE public.test_ph_dock_drop_status SET tagging_complete=true,loading_status='CHECKER' WHERE drop_id=drop_row.drop_id;
  ELSIF action='verify_line' THEN
   IF NOT drop_row.tagging_complete OR drop_row.inspector_signoff_at IS NOT NULL OR drop_row.loading_status='TRAILER_LOADED' THEN RAISE EXCEPTION 'CHECKER_STAGE_REQUIRED';END IF;
   quantity:=test_private.ops_qty(command->>'quantity');SELECT * INTO line FROM public.test_ph_soc_master WHERE soc_id=(command->>'soc_id')::uuid AND load_id=drop_row.load_id AND drop_number=drop_row.drop_number FOR UPDATE;
   IF line.soc_id IS NULL OR line.is_pink_tape OR quantity>line.pulled_qty THEN RAISE EXCEPTION 'PINK_TAPE_OR_UNPULLED_LINE';END IF;
   UPDATE public.test_ph_soc_master SET verified_qty=quantity,line_status=CASE WHEN quantity=ordered_qty THEN 'VERIFIED' ELSE line_status END WHERE soc_id=line.soc_id;
  ELSIF action='load_drop' THEN
   IF NOT drop_row.palletization_alert_sent OR NOT drop_row.tagging_complete THEN RAISE EXCEPTION 'PALLETIZATION_NOT_READY';END IF;
   UPDATE public.test_ph_soc_master SET shipped_qty=verified_qty,quantityshipped=verified_qty::text WHERE load_id=drop_row.load_id AND drop_number=drop_row.drop_number AND NOT is_pink_tape AND line_status<>'SUPERSEDED';
   UPDATE public.test_ph_dock_drop_status SET loading_status='TRAILER_LOADED' WHERE drop_id=drop_row.drop_id;
  ELSIF action='inspector_signoff' THEN
   IF actor_role NOT IN('admin','administrator','super_admin','super-admin','manager','inspector','qc') AND p.username<>'dylan_collyge' THEN RAISE EXCEPTION 'INSPECTOR_ROLE_REQUIRED';END IF;
   IF drop_row.loading_status<>'TRAILER_LOADED' OR drop_row.inspector_signoff_at IS NOT NULL OR nullif(trim(command->>'signature'),'') IS NULL THEN RAISE EXCEPTION 'LOADED_DROP_AND_SIGNATURE_REQUIRED';END IF;
   UPDATE public.test_ph_dock_drop_status SET inspector_signoff_by=p.username,inspector_signoff_at=now(),loading_status='SIGNED_OFF' WHERE drop_id=drop_row.drop_id;
  ELSE
   IF drop_row.inspector_signoff_at IS NULL OR drop_row.loading_status<>'SIGNED_OFF' OR nullif(trim(command->>'driver_signature'),'') IS NULL OR nullif(trim(command->>'seal'),'') IS NULL OR (drop_row.trailer_seal_number IS NOT NULL AND drop_row.trailer_seal_number<>command->>'seal') THEN RAISE EXCEPTION 'INSPECTOR_DRIVER_AND_MATCHING_SEAL_REQUIRED';END IF;
   UPDATE public.test_ph_dock_drop_status SET driver_signature=left(command->>'driver_signature',120),driver_signoff_at=now(),trailer_seal_number=command->>'seal',dispatched_at=now(),loading_status='DISPATCHED' WHERE drop_id=drop_row.drop_id;
   UPDATE public.test_ph_soc_master SET line_status='SHIPPED' WHERE load_id=drop_row.load_id AND drop_number=drop_row.drop_number AND NOT is_pink_tape AND line_status<>'SUPERSEDED';
  END IF;
 ELSIF action='flag_mistake' THEN
  SELECT * INTO line FROM public.test_ph_soc_master WHERE soc_id=(command->>'soc_id')::uuid FOR UPDATE;quantity:=test_private.ops_qty(command->>'quantity');
  IF line.soc_id IS NULL OR line.is_pink_tape OR line.shipped_qty>0 OR quantity<=0 OR quantity>line.ordered_qty OR NOT test_private.ops_photo_valid(command->>'bad_photo') THEN RAISE EXCEPTION 'REJECTION_EVIDENCE_REQUIRED';END IF;
  IF command->>'type'='R-all' AND quantity<>line.ordered_qty THEN RAISE EXCEPTION 'FULL_REJECTION_MUST_MATCH_LINE';END IF;
  IF command->>'type'='R-[N]' AND (quantity>=line.ordered_qty OR command->>'good_photo'=command->>'bad_photo' OR NOT test_private.ops_photo_valid(command->>'good_photo')) THEN RAISE EXCEPTION 'PARTIAL_REJECTION_NEEDS_TWO_PHOTOS';END IF;
  IF command->>'type' NOT IN('R-all','R-[N]') THEN RAISE EXCEPTION 'INVALID_REJECTION_TYPE';END IF;
  IF quantity<line.ordered_qty THEN
   UPDATE public.test_ph_soc_master SET ordered_qty=ordered_qty-quantity,quantityordered=(ordered_qty-quantity)::text,pulled_qty=least(pulled_qty,ordered_qty-quantity),verified_qty=least(verified_qty,ordered_qty-quantity),assigned_qty=0 WHERE soc_id=line.soc_id;
   new_id:=gen_random_uuid();child:=test_private.ops_clone_soc(line,jsonb_build_object('unique_id','TEST-'||new_id,'soc_id',new_id,'ordered_qty',quantity,'quantityordered',quantity::text,'pulled_qty',least(quantity,line.pulled_qty),'verified_qty',0,'shipped_qty',0,'quantityshipped','0','assigned_qty',0,'mistake_qty',quantity,'is_pink_tape',true,'is_split_line',true,'parent_soc_id',line.soc_id,'line_status','MISTAKE'));line:=child;
  ELSE UPDATE public.test_ph_soc_master SET is_pink_tape=true,mistake_qty=quantity,verified_qty=0,assigned_qty=0,line_status='MISTAKE' WHERE soc_id=line.soc_id;END IF;
  INSERT INTO public.test_ph_mistake_queue(soc_id,itemcode,common_name,rejection_type,rejected_qty,bad_plant_photo_url,good_plant_photo_url,old_location,season_code,created_by) VALUES(line.soc_id,line.itemcode,line.commonname,command->>'type',quantity,command->>'bad_photo',command->>'good_photo',coalesce(line.locationcode,''),line.season,p.id) RETURNING to_jsonb(test_ph_mistake_queue.*) INTO result;
 ELSIF action='replace_location' THEN
  SELECT * INTO line FROM public.test_ph_soc_master WHERE soc_id=(command->>'soc_id')::uuid FOR UPDATE;
  IF line.soc_id IS NULL OR line.shipped_qty>0 OR line.line_status IN('SUPERSEDED','SHIPPED') OR jsonb_array_length(command->'allocations') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'REPLACEMENT_LINE_REQUIRED';END IF;
  SELECT sum(test_private.ops_qty(value->>'qty')),count(DISTINCT value->>'row_uid') INTO total,remaining FROM jsonb_array_elements(command->'allocations');IF total<>line.ordered_qty OR remaining<>jsonb_array_length(command->'allocations') THEN RAISE EXCEPTION 'ALLOCATION_SUM_OR_DUPLICATE_ERROR';END IF;
  family:=public.test_fn_normalize_itemcode(line.itemcode);
  IF NOT EXISTS(SELECT 1 FROM public.test_ph_master_inventory WHERE public.test_fn_normalize_itemcode(itemcode)=family) THEN SELECT CASE WHEN count(DISTINCT public.test_fn_normalize_itemcode(itemcode))=1 THEN min(public.test_fn_normalize_itemcode(itemcode)) END INTO family FROM public.test_ph_master_inventory WHERE public.test_fn_normalize_itemcode(itemcode) LIKE family||'.%';END IF;
  IF family IS NULL THEN RAISE EXCEPTION 'AMBIGUOUS_ITEMCODE';END IF;
  UPDATE public.test_ph_soc_master SET line_status='SUPERSEDED',quantityordered='0',ordered_qty=0,verified_qty=0,mistake_qty=0,assigned_qty=0,is_pink_tape=false,suspend='N' WHERE soc_id=line.soc_id;
  result:='[]';FOR alloc IN SELECT value FROM jsonb_array_elements(command->'allocations') ORDER BY value->>'row_uid' LOOP
   quantity:=test_private.ops_qty(alloc->>'qty');SELECT * INTO master FROM public.test_ph_master_inventory WHERE unique_id=alloc->>'row_uid' FOR UPDATE;
   IF master.unique_id IS NULL OR public.test_fn_normalize_itemcode(master.itemcode)<>family OR quantity<=0 THEN RAISE EXCEPTION 'EXACT_ITEM_ROW_REQUIRED';END IF;
   IF NOT test_private.ops_season_allowed(coalesce(nullif(master.lotcode,''),master.season)) THEN RAISE EXCEPTION 'SEASON_CODE_INELIGIBLE';END IF;
   IF test_private.ops_qty(master.ptravailable)<quantity OR test_private.ops_qty(master.ptronhand)<quantity THEN RAISE EXCEPTION 'INSUFFICIENT_LOCATION_BALANCE';END IF;
   UPDATE public.test_ph_master_inventory SET ptravailable=(test_private.ops_qty(ptravailable)-quantity)::text,ptronhand=(test_private.ops_qty(ptronhand)-quantity)::text WHERE unique_id=master.unique_id;
   new_id:=gen_random_uuid();child:=test_private.ops_clone_soc(line,jsonb_build_object('unique_id','TEST-'||new_id,'soc_id',new_id,'itemcode',master.itemcode,'locationcode',master.locationcode,'lotcode',master.lotcode,'season',master.season,'priority',master.priority,'ordered_qty',quantity,'quantityordered',quantity::text,'shipped_qty',0,'quantityshipped','0','pulled_qty',0,'verified_qty',0,'mistake_qty',0,'assigned_qty',0,'assigned_wingding_id',NULL,'is_pink_tape',false,'is_split_line',true,'parent_soc_id',line.soc_id,'line_status','PENDING_PULL','suspend','Y'));result:=result||jsonb_build_array(to_jsonb(child));
  END LOOP;
  UPDATE public.test_ph_mistake_queue SET status='RESOLVED',resolved_by=p.id,replacement_locations=command->'allocations',updated_at=now() WHERE soc_id=line.soc_id AND status<>'RESOLVED';
 ELSIF action='hl_stage' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('test:HL:C.12.000',31));quantity:=test_private.ops_qty(command->>'quantity');remaining:=test_private.ops_qty(command->>'bay');
  IF remaining NOT BETWEEN 1 AND 23 OR quantity<=0 THEN RAISE EXCEPTION 'VALID_BAY_AND_QUANTITY_REQUIRED';END IF;
  IF (SELECT count(DISTINCT bay) FROM public.test_ph_hl_staging WHERE released_at IS NULL)>=11 THEN RAISE EXCEPTION 'HL_STAGING_BAY_EXHAUSTION';END IF;
  SELECT * INTO master FROM public.test_ph_master_inventory WHERE unique_id=command->>'row_uid' FOR UPDATE;IF master.unique_id IS NULL OR master.locationcode='C.12.000' OR test_private.ops_qty(master.ptravailable)<quantity OR test_private.ops_qty(master.ptronhand)<quantity THEN RAISE EXCEPTION 'INSUFFICIENT_LOCATION_BALANCE';END IF;
  IF nullif(command->>'po_source','') IS NOT NULL THEN
   po_value:=test_private.ops_hl_po(command->>'po_source',command->>'po_row_id');family:=public.test_fn_normalize_itemcode(coalesce(po_value->>'item_code',po_value->>'itemcode'));
   IF public.test_fn_normalize_itemcode(master.itemcode)<>family AND (EXISTS(SELECT 1 FROM public.test_ph_master_inventory WHERE public.test_fn_normalize_itemcode(itemcode)=family) OR public.test_fn_normalize_itemcode(master.itemcode) NOT LIKE family||'.%' OR (SELECT count(DISTINCT public.test_fn_normalize_itemcode(itemcode)) FROM public.test_ph_master_inventory WHERE public.test_fn_normalize_itemcode(itemcode) LIKE family||'.%')<>1) THEN RAISE EXCEPTION 'EXACT_ITEM_ROW_REQUIRED';END IF;
   po_remaining:=coalesce(nullif(po_value->>'po_remain',''),nullif(po_value->>'total_quantity_ordered',''),'0')::numeric-(SELECT coalesce(sum(s.quantity),0) FROM public.test_ph_hl_staging s WHERE s.po_source=command->>'po_source' AND s.po_row_id=command->>'po_row_id');
   IF quantity>po_remaining THEN RAISE EXCEPTION 'HL_PURCHASE_ORDER_BALANCE_EXCEEDED';END IF;
   planned_location:=nullif(po_value->>'locationcode','');
  END IF;
  planned_location:=coalesce(planned_location,nullif(command->>'requested_location',''));deviation:=coalesce((command->>'deviation')::boolean,false) OR (planned_location IS NOT NULL AND planned_location<>master.locationcode);
  SELECT * INTO target_row FROM public.test_ph_master_inventory WHERE itemcode=master.itemcode AND locationcode='C.12.000' AND lotcode IS NOT DISTINCT FROM master.lotcode AND priority IS NOT DISTINCT FROM master.priority AND saleyear IS NOT DISTINCT FROM master.saleyear ORDER BY unique_id LIMIT 1 FOR UPDATE;
  IF target_row.unique_id IS NULL THEN
   new_id:=gen_random_uuid();SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO fields FROM pg_attribute WHERE attrelid='public.test_ph_master_inventory'::regclass AND attnum>0 AND NOT attisdropped AND attgenerated='';
   EXECUTE format('INSERT INTO public.test_ph_master_inventory(%s) SELECT %s FROM jsonb_populate_record(NULL::public.test_ph_master_inventory,$1) RETURNING *',fields,fields) INTO target_row USING to_jsonb(master)||jsonb_build_object('unique_id','TEST-HL-'||new_id,'locationcode','C.12.000','ptronhand',quantity::text,'ptravailable',quantity::text,'photo_link',NULL,'photo_name',NULL,'date_completed',NULL);
  ELSE UPDATE public.test_ph_master_inventory SET ptronhand=(test_private.ops_qty(ptronhand)+quantity)::text,ptravailable=(test_private.ops_qty(ptravailable)+quantity)::text WHERE unique_id=target_row.unique_id;END IF;
  UPDATE public.test_ph_master_inventory SET ptravailable=(test_private.ops_qty(ptravailable)-quantity)::text,ptronhand=(test_private.ops_qty(ptronhand)-quantity)::text WHERE unique_id=master.unique_id;
  INSERT INTO public.test_ph_hl_staging(bay,source_uid,target_uid,itemcode,quantity,created_by,po_source,po_row_id,requested_location) VALUES(remaining,master.unique_id,target_row.unique_id,master.itemcode,quantity,p.id,command->>'po_source',command->>'po_row_id',planned_location) RETURNING to_jsonb(test_ph_hl_staging.*) INTO result;
  IF deviation THEN INSERT INTO public.test_ph_reclass_inquiries(itemcode,common_name,contsize,lotcode,old_location,new_location,quantity,actor_id,puller_signature,notes) VALUES(master.itemcode,master.commonname,master.contsize,master.lotcode,master.locationcode,'C.12.000',quantity,p.id,p.username,command->>'notes');END IF;
 ELSIF action='hl_release' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('test:HL:C.12.000',31));SELECT * INTO stage FROM public.test_ph_hl_staging WHERE staging_id=(command->>'staging_id')::uuid AND released_at IS NULL FOR UPDATE;IF stage.staging_id IS NULL THEN RAISE EXCEPTION 'ACTIVE_STAGING_RECORD_REQUIRED';END IF;
  SELECT * INTO master FROM public.test_ph_master_inventory WHERE unique_id=stage.target_uid FOR UPDATE;IF test_private.ops_qty(master.ptronhand)<stage.quantity OR test_private.ops_qty(master.ptravailable)<stage.quantity THEN RAISE EXCEPTION 'STAGING_BALANCE_CHANGED';END IF;
  UPDATE public.test_ph_master_inventory SET ptronhand=(test_private.ops_qty(ptronhand)-stage.quantity)::text,ptravailable=(test_private.ops_qty(ptravailable)-stage.quantity)::text WHERE unique_id=master.unique_id;UPDATE public.test_ph_hl_staging SET released_at=now() WHERE staging_id=stage.staging_id;
 ELSE RAISE EXCEPTION 'UNKNOWN_TEST_OPERATION';END IF;
 result:=jsonb_build_object('ok',true,'command_id',command_id,'action',action,'result',result,'committed_at',now());
 INSERT INTO test_private.ops_command_receipts(command_id,actor_id,action,request_hash,receipt) VALUES(command_id,p.id,action,request_hash,result);
 IF action IN('flag_mistake','replace_location','breakdown_swap','dispatch') OR (action='hl_stage' AND deviation) THEN INSERT INTO test_private.ops_outbox(event_key,payload) VALUES(command_id::text,jsonb_build_object('subject','AgData Test: '||action,'actor',p.username,'command',command,'receipt',result,'product',CASE WHEN action='hl_stage' THEN jsonb_build_object('itemcode',master.itemcode,'commonname',master.commonname,'contsize',master.contsize,'lotcode',master.lotcode,'old_location',master.locationcode,'new_location','C.12.000','quantity',quantity,'puller_signature',p.username) ELSE '{}'::jsonb END));END IF;
 RETURN result;
END $$;

DO $$ DECLARE n text; BEGIN FOREACH n IN ARRAY ARRAY['test_ph_pullers','test_ph_wingding_units','test_ph_order_pulling_teams','test_ph_dock_drop_status','test_ph_docks','test_ph_mistake_queue','test_ph_hl_staging','test_ph_reclass_inquiries'] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',n);EXECUTE format('GRANT SELECT ON public.%I TO authenticated',n);EXECUTE format('GRANT ALL ON public.%I TO service_role',n);EXECUTE format('CREATE POLICY test_active_read ON public.%I FOR SELECT TO authenticated USING ((SELECT test_private.current_profile()).id IS NOT NULL)',n);END LOOP;END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA test_private FROM anon,authenticated,PUBLIC;
REVOKE ALL ON FUNCTION public.test_ops_command(uuid,jsonb),public.test_ops_snapshot(),public.test_ops_inventory(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.test_ops_command(uuid,jsonb),public.test_ops_snapshot(),public.test_ops_inventory(text) TO authenticated;
COMMIT;
