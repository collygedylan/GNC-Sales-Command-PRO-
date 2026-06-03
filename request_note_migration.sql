-- Keeps sales-rep request notes separate from worker-entered request comments.
alter table public.v2_active_request
    add column if not exists request_note text;

comment on column public.v2_active_request.request_note is
    'Optional note entered when the request is created. This is not the worker comments field.';

-- Prior app versions saved the request note into req_comments.
-- Move only still-pending rows so completed rows with true worker comments are left alone.
update public.v2_active_request
set
    request_note = nullif(trim(req_comments), ''),
    req_comments = null
where nullif(trim(coalesce(req_comments, '')), '') is not null
  and nullif(trim(coalesce(request_note, '')), '') is null
  and nullif(trim(coalesce(date_completed::text, '')), '') is null
  and lower(trim(coalesce(req_status, 'pending'))) <> 'complete';
