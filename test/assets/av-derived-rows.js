(function (root) {
  'use strict';

  const MAX_ENTRIES = 4;
  const entries = new Map();
  const jobs = new Map();
  let nextJobId = 0;
  const scheduledTasks = new Map();
  let nextTaskId = 0;
  const taskChannel = typeof root.MessageChannel === 'function' ? new root.MessageChannel() : null;
  if (taskChannel) taskChannel.port1.onmessage = event => {
    const callback = scheduledTasks.get(event.data);
    scheduledTasks.delete(event.data);
    if (callback) callback();
  };

  function schedule(callback) {
    // Yield between bounded slices without the browser's nested-timer clamp.
    // Pending messages remain cancellable when identity or source changes.
    if (taskChannel) {
      const id = ++nextTaskId;
      scheduledTasks.set(id, callback);
      taskChannel.port2.postMessage(id);
      return id;
    }
    return root.setTimeout(callback, 0);
  }

  function cancelScheduled(id) {
    if (taskChannel) scheduledTasks.delete(id);
    else root.clearTimeout(id);
  }

  function removeJob(key, job, value = null) {
    if (jobs.get(key) !== job) return;
    jobs.delete(key);
    if (job.timer != null) cancelScheduled(job.timer);
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
      maxSliceMs: Math.max(0, Number(input.maxSliceMs) || 0),
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
        const clock = job.maxSliceMs && typeof root.performance?.now === 'function' ? root.performance : null;
        const started = clock ? clock.now() : 0;
        for (; job.cursor < end; job.cursor += 1) {
          if (clock && job.cursor > start && clock.now() - started >= job.maxSliceMs) break;
          const mapped = job.mapRow(job.rows[job.cursor], job.cursor);
          if (mapped !== null && mapped !== undefined) job.output.push(mapped);
        }
        if (job.onSlice) job.onSlice(start, job.cursor);
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
        if (job.timer != null) cancelScheduled(job.timer);
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
