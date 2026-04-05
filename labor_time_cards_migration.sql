create table if not exists public.v2_employee_time_cards (
  unique_id text primary key,
  supervisor_username text not null,
  supervisor_display text,
  employee_name text not null,
  employee_code text,
  department text,
  week_ending date not null,
  days jsonb not null default '{}'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  notes text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_v2_employee_time_cards_supervisor_week
  on public.v2_employee_time_cards (supervisor_username, week_ending desc);

create index if not exists idx_v2_employee_time_cards_employee_week
  on public.v2_employee_time_cards (employee_name, week_ending desc);
