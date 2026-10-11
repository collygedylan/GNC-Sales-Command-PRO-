// Read-only schema metadata. This query never selects application rows or secrets.
export function catalogQuery(schemas) {
  if (!schemas.length || schemas.some(name => !/^[a-z_]+$/.test(name))) throw new Error('Invalid catalog schema scope');
  const names = schemas.map(name => `'${name}'`).join(',');
  return `with function_path as materialized (select set_config('search_path','',true) as configured),
  ns as (select * from pg_namespace where nspname in (${names})),
  relations as (select c.*, n.nspname from pg_class c join ns n on n.oid=c.relnamespace where c.relkind in ('r','p','v','m','S'))
  select jsonb_build_object(
    'schemas', (select jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',
      (select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable)) from aclexplode(coalesce(nspacl,acldefault('n',nspowner))) a))) from ns),
    'extensions', (select jsonb_agg(jsonb_build_object('name',e.extname,'schema',n.nspname,'version',e.extversion)) from pg_extension e join pg_namespace n on n.oid=e.extnamespace),
    'relations', (select jsonb_agg(jsonb_build_object('schema',c.nspname,'name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
      'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'options',c.reloptions,
      'view',case when c.relkind in ('v','m') then pg_get_viewdef(c.oid,true) end,
      'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
        'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),
        'sequence',case when a.attidentity<>'' then pg_get_serial_sequence(format('%I.%I',c.nspname,c.relname),a.attname) end) order by a.attnum)
        from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
      'constraints',(select jsonb_agg(jsonb_build_object('name',conname,'kind',contype,'definition',pg_get_constraintdef(oid,true))) from pg_constraint where conrelid=c.oid),
      'indexes',(select jsonb_agg(pg_get_indexdef(i.indexrelid)) from pg_index i where i.indrelid=c.oid and not exists(select 1 from pg_constraint k where k.conindid=i.indexrelid)),
      'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid,true)) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
      'acl',(select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable)) from aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner))) a),
      'policies',(select jsonb_agg(jsonb_build_object('name',polname,'permissive',polpermissive,'command',polcmd,
        'roles',(select jsonb_agg(case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end) from unnest(polroles) r),
        'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid))) from pg_policy where polrelid=c.oid),
      'sequence',(select jsonb_build_object('type',format_type(seqtypid,null),'start',seqstart::text,'increment',seqincrement::text,'min',seqmin::text,'max',seqmax::text,'cache',seqcache::text,'cycle',seqcycle,
        'ownedBy',(select format('%I.%I.%I',n.nspname,t.relname,a.attname) from pg_depend dep join pg_class t on t.oid=dep.refobjid join pg_namespace n on n.oid=t.relnamespace join pg_attribute a on a.attrelid=t.oid and a.attnum=dep.refobjsubid where dep.classid='pg_class'::regclass and dep.objid=c.oid and dep.deptype in ('a','i') limit 1),
        'identity',exists(select 1 from pg_depend dep where dep.classid='pg_class'::regclass and dep.objid=c.oid and dep.deptype='i')) from pg_sequence where seqrelid=c.oid)
    ) order by c.nspname,c.relname) from relations c),
    'functions',(select jsonb_agg(jsonb_build_object('schema',p.nspname,'name',p.proname,'identityArgs',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),
      'definition',case when pg_get_functiondef(p.oid) ~ 'eyJ[A-Za-z0-9_-]{20}' then null else pg_get_functiondef(p.oid) end,
      'sensitiveLiteral',pg_get_functiondef(p.oid) ~ 'eyJ[A-Za-z0-9_-]{20}',
      'publicTypes',(select jsonb_agg(distinct t.typname) from unnest(coalesce(p.proallargtypes,p.proargtypes::oid[])||array[p.prorettype]) o join pg_type t on t.oid=o join pg_namespace tn on tn.oid=t.typnamespace where tn.nspname='public'),
      'acl',(select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable)) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)
    ) order by p.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) from function_path fp cross join lateral
      (select proc.*,schema.nspname from pg_proc proc join ns schema on schema.oid=proc.pronamespace where proc.prokind='f' and fp.configured='') p),
    'types',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',t.typname,'kind',t.typtype,
      'labels',(select jsonb_agg(enumlabel order by enumsortorder) from pg_enum where enumtypid=t.oid))) from pg_type t join ns n on n.oid=t.typnamespace where t.typtype in ('e','d'))
  ) as catalog`;
}
