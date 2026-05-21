alter table public.v2_active_request
  add column if not exists desired_spec text,
  add column if not exists desired_caliper text;

comment on column public.v2_active_request.desired_spec is 'Rep-requested desired spec kept separate from completed request spec.';
comment on column public.v2_active_request.desired_caliper is 'Rep-requested desired caliper kept separate from completed request caliper.';
