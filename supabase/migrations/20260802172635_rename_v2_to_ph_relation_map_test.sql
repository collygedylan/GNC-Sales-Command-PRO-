-- No-op guard migration kept to mirror production migration history.
create temp table if not exists tmp_v2_ph_relation_map_test (
  old_name text primary key
) on commit drop;

drop table if exists tmp_v2_ph_relation_map_test;
