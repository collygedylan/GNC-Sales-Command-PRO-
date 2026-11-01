BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION private.access_username_v23119(value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN normalized='nally_aguilar' THEN 'nelly_aguilar'
 WHEN normalized ~ '^(chance_alldredge|alldredge_chance)(_south_tx)?$' THEN 'chance_alldredge' ELSE normalized END
 FROM (SELECT trim(both '_' from regexp_replace(lower(btrim(coalesce(value,''))),'[^a-z0-9]+','_','g')) normalized) n
$$;
CREATE OR REPLACE FUNCTION private.canonical_sales_rep_key_v23127(value text) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE raw text:=btrim(coalesce(value,'')); base text; candidate text; matched text;
BEGIN
 base:=regexp_replace(split_part(raw,'@',1),'\s+[-–—]\s+.*$','');
 IF position(',' in base)>0 THEN base:=btrim(split_part(base,',',2))||' '||btrim(split_part(base,',',1)); END IF;
 candidate:=private.access_username_v23119(base);
 SELECT private.access_username_v23119(p.username) INTO matched FROM public.profiles p
 WHERE p.disabled_at IS NULL AND regexp_replace(upper(p.role),'[^A-Z]','','g') IN ('REP','SALESREP','SALES')
 AND (candidate=private.access_username_v23119(p.username) OR (raw !~ '\s' AND position('_' in raw)>0 AND starts_with(candidate,private.access_username_v23119(p.username)||'_')))
 ORDER BY length(p.username) DESC LIMIT 1;
 RETURN coalesce(matched,private.access_username_v23119(raw));
END $$;
REVOKE ALL ON FUNCTION private.canonical_sales_rep_key_v23127(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.canonical_sales_rep_key_v23127(text) TO service_role;
CREATE OR REPLACE FUNCTION sales_private.rep_identity_key_v2394(value text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(string_agg(part,' ' ORDER BY part),'')
 FROM regexp_split_to_table(private.canonical_sales_rep_key_v23127(split_part(coalesce(value,''),'@',1)),'[^a-z0-9]+') part WHERE part<>''
$$;
CREATE OR REPLACE FUNCTION private.canonical_sales_rep_access_v23127(value jsonb) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_object_agg(rep,flag),'{}') FROM (
 SELECT private.canonical_sales_rep_key_v23127(key) rep,CASE WHEN bool_or(value='N') THEN 'N' ELSE 'Y' END flag
 FROM jsonb_each_text(coalesce(value,'{}')) GROUP BY private.canonical_sales_rep_key_v23127(key)) flags
$$;
REVOKE ALL ON FUNCTION private.canonical_sales_rep_access_v23127(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.canonical_sales_rep_access_v23127(jsonb) TO service_role;
CREATE OR REPLACE FUNCTION private.access_rep_roster_v23119() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_object_agg(rep,'Y'),'{}') FROM (SELECT DISTINCT private.canonical_sales_rep_key_v23127(name) rep FROM (
 SELECT btrim(username) name FROM public.profiles WHERE disabled_at IS NULL AND regexp_replace(upper(role),'[^A-Z]','','g') IN ('REP','SALESREP')
 UNION SELECT btrim(salesrepname) FROM public.ph_customer_consignee_sales_reps WHERE nullif(btrim(salesrepname),'') IS NOT NULL) source WHERE nullif(name,'') IS NOT NULL) reps
$$;
-- Extend the existing validated alias trigger; do not introduce another mutation path.
DO $$ DECLARE definition text; needle text:=' NEW.updated_at:=clock_timestamp(); RETURN NEW;'; BEGIN
 definition:=pg_get_functiondef('private.sync_access_matrix_aliases_v23119()'::regprocedure);
 IF position('canonical_sales_rep_access_v23127' in definition)=0 THEN
 IF position(needle in definition)=0 THEN RAISE EXCEPTION 'ACCESS_ALIAS_TRIGGER_CONTRACT_CHANGED'; END IF;
 definition:=replace(definition,needle,'  NEW.sales_rep_access:=private.canonical_sales_rep_access_v23127(NEW.sales_rep_access); NEW.allowed_request_reps:=NEW.sales_rep_access;'||chr(10)||needle);
 EXECUTE definition;
 END IF;
END $$;
-- Merge both aliases with explicit N winning, including conflicting spelling variants.
WITH merged AS (SELECT profile_id,private.canonical_sales_rep_access_v23127(
 (SELECT jsonb_object_agg(key,flag) FROM (SELECT key,CASE WHEN bool_or(value='N') THEN 'N' ELSE 'Y' END flag FROM (
 SELECT * FROM jsonb_each_text(sales_rep_access) UNION ALL SELECT * FROM jsonb_each_text(allowed_request_reps)) entries GROUP BY key) flags)) value FROM public.user_access)
UPDATE public.user_access u SET sales_rep_access=m.value,allowed_request_reps=m.value,revision=u.revision+1 FROM merged m
WHERE u.profile_id=m.profile_id AND (u.sales_rep_access IS DISTINCT FROM m.value OR u.allowed_request_reps IS DISTINCT FROM m.value);
UPDATE public.role_access_baselines SET matrix_permissions=jsonb_set(matrix_permissions,'{sales_rep_access}',private.canonical_sales_rep_access_v23127(matrix_permissions->'sales_rep_access')),revision=revision+1
WHERE matrix_permissions ? 'sales_rep_access' AND matrix_permissions->'sales_rep_access' IS DISTINCT FROM private.canonical_sales_rep_access_v23127(matrix_permissions->'sales_rep_access');
DO $$ BEGIN
 IF sales_private.rep_identity_key_v2394('unknown.person@example.com') IS DISTINCT FROM sales_private.rep_identity_key_v2394('unknown_person') THEN RAISE EXCEPTION 'REP_EMAIL_PREFIX_CONTRACT_FAILED'; END IF;
 IF private.canonical_sales_rep_key_v23127('Alldredge, Chance - South TX')<>'chance_alldredge' OR private.access_rep_roster_v23119() ? 'chance_alldredge_south_tx' THEN RAISE EXCEPTION 'CANONICAL_REP_CONTRACT_FAILED'; END IF;
 IF EXISTS(SELECT 1 FROM public.user_access u CROSS JOIN LATERAL jsonb_object_keys(u.sales_rep_access||u.allowed_request_reps) key WHERE key ~* 'alldredge.*south') THEN RAISE EXCEPTION 'DUPLICATE_CHANCE_REP_KEY'; END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
