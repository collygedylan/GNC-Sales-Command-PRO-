-- Move old no-model diagnostic noise out of Dylan's pending issue queue.
-- This only affects rows that were promoted to pending approval solely because
-- the diagnostics model/checkpoint was not configured.

update public.v2_ml_image_jobs
set
  status = 'approved',
  manual_review = false,
  diagnosis = 'No disease issue detected from available references.',
  recommended_treatment = 'No treatment recommended.',
  approved_by_username = coalesce(approved_by_username, 'ml_worker'),
  approved_by_display = coalesce(approved_by_display, 'ML Worker'),
  approved_at = coalesce(approved_at, now()),
  processing_started_at = null,
  updated_at = now()
where status = 'pending_approval'
  and coalesce(manual_review, false) = true
  and lower(coalesce(diagnosis, '')) = 'manual review required'
  and (
    lower(coalesce(recommended_treatment, '')) like '%no diagnostics model%'
    or lower(coalesce(last_error, '')) like '%no diagnostics model%'
    or lower(coalesce(last_error, '')) like '%no model checkpoint%'
  );
