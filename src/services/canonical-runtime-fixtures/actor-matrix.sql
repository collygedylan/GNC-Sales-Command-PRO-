fixture_matrix AS (
  INSERT INTO public.user_access(profile_id,username,display_name,role,userrole,
    make_request,can_make_request,request_all_reps,edit_any_row,can_edit_all_rows,edit_assigned_rows_only,can_edit_assigned_items,
    submit_reclass,view_permissions)
  SELECT p.id,p.username,p.display_name,p.role,p.role,'Y','Y','Y',
    CASE WHEN upper(p.role) LIKE '%EVAL%' THEN 'N' ELSE 'Y' END,
    CASE WHEN upper(p.role) LIKE '%EVAL%' THEN 'N' ELSE 'Y' END,
    CASE WHEN upper(p.role) LIKE '%EVAL%' THEN 'Y' ELSE 'N' END,
    CASE WHEN upper(p.role) LIKE '%EVAL%' THEN 'Y' ELSE 'N' END,__RECLASS_FLAG__,
    '{"view_que_request":"Y"}'::jsonb
  FROM public.profiles p JOIN fixture_admitted admitted ON admitted.profile_id=p.id
  ON CONFLICT(profile_id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,
    role=excluded.role,userrole=excluded.userrole,make_request='Y',can_make_request='Y',request_all_reps='Y',
    edit_any_row=excluded.edit_any_row,can_edit_all_rows=excluded.can_edit_all_rows,
    edit_assigned_rows_only=excluded.edit_assigned_rows_only,can_edit_assigned_items=excluded.can_edit_assigned_items,
    submit_reclass=excluded.submit_reclass,
    view_permissions=excluded.view_permissions
  RETURNING profile_id
)
INSERT INTO public.user_access_control(profile_id,username,display_name,canonical_role,active,permission_overrides)
SELECT p.id,p.username,p.display_name,private.canonical_user_access_role_v1(p.role),true,__PERMISSION_OVERRIDES__::jsonb
FROM public.profiles p JOIN fixture_matrix matrix ON matrix.profile_id=p.id
ON CONFLICT(profile_id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,
  canonical_role=excluded.canonical_role,active=true,permission_overrides=excluded.permission_overrides;
