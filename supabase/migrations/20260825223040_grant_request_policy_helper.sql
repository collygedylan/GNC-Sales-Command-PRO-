begin;

-- RLS policy expressions execute as the querying authenticated role, even when
-- the helper itself is SECURITY DEFINER. The helper returns only an authorization
-- boolean and exposes no Request data.
grant execute on function private.can_work_request_identity(text, text, text)
  to authenticated;

commit;
