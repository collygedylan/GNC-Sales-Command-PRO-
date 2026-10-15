(function (root) {
  'use strict';

  const MAX_ENTRIES = 4;
  const entries = new Map();
  const jobs = new Map();
  let nextJobId = 0;

  function schedule(callback) {
    return root.setTimeout(callback, 0);
  }

  function removeJob(key, job, value = null) {
    if (jobs.get(key) !== job) return;
    jobs.delete(key);
    if (job.timer != null) root.clearTimeout(job.timer);
    job.resolve(value);
  }

  function remember(key, entry) {
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
  }

  function cancelOtherJobs(scope, activeKey = '') {
    const normalizedScope = String(scope || '').trim();
    const normalizedKey = String(activeKey || '').trim();
    for (const [key, job] of jobs) {
      if (job.scope === normalizedScope && key !== normalizedKey) removeJob(key, job);
    }
  }

  function peek(key, scope) {
    const entry = entries.get(key);
    if (!entry || entry.scope !== scope) return null;
    entries.delete(key);
    entries.set(key, entry);
    return entry;
  }

  function prepare(options) {
    const input = options && typeof options === 'object' ? options : {};
    const key = String(input.key || '').trim();
    const scope = String(input.scope || '').trim();
    const sourceKey = String(input.sourceKey || '').trim();
    const rows = input.rows;
    const mapRow = input.mapRow;
    if (!key || !scope || !sourceKey || !Array.isArray(rows) || typeof mapRow !== 'function') {
      return Promise.reject(new Error('AV_DERIVED_ROWS_INPUT_INVALID'));
    }
    cancelOtherJobs(scope, key);
    const current = peek(key, scope);
    if (current && current.sourceKey === sourceKey) return Promise.resolve(current.rows);
    const active = jobs.get(key);
    if (active && active.scope === scope && active.sourceKey === sourceKey) return active.promise;
    if (active) removeJob(key, active);

    const job = { id: ++nextJobId, key, scope, sourceKey, rows, mapRow, output: [], cursor: 0,
      chunkSize: Math.max(16, Math.min(512, Math.floor(Number(input.chunkSize) || 192))),
      isCurrent: typeof input.isCurrent === 'function' ? input.isCurrent : () => true,
      finalize: typeof input.finalize === 'function' ? input.finalize : value => value,
      onSlice: typeof input.onSlice === 'function' ? input.onSlice : null,
      timer: null, resolve: null, reject: null, promise: null };
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    jobs.set(key, job);

    const runSlice = () => {
      if (jobs.get(key) !== job) { removeJob(key, job); return; }
      try {
        if (!job.isCurrent()) { removeJob(key, job); return; }
        const start = job.cursor;
        const end = Math.min(job.rows.length, start + job.chunkSize);
        for (; job.cursor < end; job.cursor += 1) {
          const mapped = job.mapRow(job.rows[job.cursor], job.cursor);
          if (mapped !== null && mapped !== undefined) job.output.push(mapped);
        }
        if (job.onSlice) job.onSlice(start, end);
        if (job.cursor < job.rows.length) {
          job.timer = schedule(runSlice);
          return;
        }
        if (jobs.get(key) !== job || !job.isCurrent()) { removeJob(key, job); return; }
        const completeRows = job.finalize(job.output);
        if (!Array.isArray(completeRows)) throw new Error('AV_DERIVED_ROWS_FINALIZE_INVALID');
        remember(key, { scope, sourceKey, rows: completeRows });
        removeJob(key, job, completeRows);
      } catch (error) {
        if (jobs.get(key) === job) jobs.delete(key);
        if (job.timer != null) root.clearTimeout(job.timer);
        job.reject?.(error);
      }
    };

    // Rendering consumers already have a bounded preview. Let it paint before
    // starting the full cohort, while retaining synchronous small-job callers.
    if (input.deferFirstSlice === true) job.timer = schedule(runSlice);
    else runSlice();
    return job.promise;
  }

  function clearScope(scope) {
    const normalized = String(scope || '').trim();
    for (const [key, entry] of entries) if (entry.scope === normalized) entries.delete(key);
    for (const [key, job] of jobs) if (job.scope === normalized) removeJob(key, job);
  }

  function invalidate(key) {
    const normalized = String(key || '').trim();
    entries.delete(normalized);
    const job = jobs.get(normalized);
    if (job) removeJob(normalized, job);
  }

  root.AgMetricAvDerivedRows = Object.freeze({ peek, prepare, cancelOtherJobs, clearScope, invalidate });
})(window);
