export function installReclassStageTiming(target, names, now = () => performance.now(), capture = {}) {
  const captureSelector = capture.selector || '#argos-inventory-transaction-apply';
  const captureMark = capture.markName || 'reclass-610-apply-captured';
  const captureLabel = capture.label || 'Apply';
  const records = [];
  const missing = [];
  const originalFunctions = new Map();
  let capturedAt = null;
  const push = (entry) => {
    if (capturedAt != null) {
      const elapsed = Math.max(0, now() - capturedAt);
      records.push({ sinceCaptureMs: elapsed, ...(captureLabel === 'Apply' ? { sinceApplyMs: elapsed } : {}), ...entry });
    }
  };
  const captureApply = (event) => {
    const element = event.target instanceof target.Element ? event.target : null;
    if (!element?.closest(captureSelector) || capturedAt != null) return;
    capturedAt = now();
    try { target.performance.mark(captureMark); } catch {}
  };
  target.document.addEventListener('click', captureApply, true);

  const recordLongTask = (entry) => {
    if (capturedAt != null && entry.startTime + entry.duration >= capturedAt) {
      const elapsed = Math.max(0, entry.startTime - capturedAt);
      records.push({ type: 'longtask', sinceCaptureMs: elapsed, ...(captureLabel === 'Apply' ? { sinceApplyMs: elapsed } : {}), durationMs: entry.duration });
    }
  };
  let longTaskObserver = null;
  let longTaskSupported = false;
  try {
    if (typeof target.PerformanceObserver === 'function'
      && target.PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      longTaskSupported = true;
      longTaskObserver = new target.PerformanceObserver((list) => {
        for (const entry of list.getEntries()) recordLongTask(entry);
      });
      longTaskObserver.observe({ type: 'longtask', buffered: true });
    }
  } catch { longTaskObserver = null; longTaskSupported = false; }

  for (const name of names) {
    const original = target[name];
    if (typeof original !== 'function') { missing.push(name); continue; }
    originalFunctions.set(name, original);
    target[name] = function (...args) {
      const startedAt = now();
      let result;
      try { result = Reflect.apply(original, this, args); }
      catch (error) {
        push({ type: 'function', name, phase: 'sync', durationMs: now() - startedAt, outcome: 'throw' });
        throw error;
      }
      push({ type: 'function', name, phase: 'sync', durationMs: now() - startedAt, outcome: 'return' });
      if (result && typeof result.then === 'function') {
        // Observe settlement without replacing the original Promise returned to
        // application code. The observer handlers are deliberately nonthrowing.
        try {
          result.then(
            () => { push({ type: 'function', name, phase: 'settlement', durationMs: now() - startedAt, outcome: 'resolve' }); },
            () => { push({ type: 'function', name, phase: 'settlement', durationMs: now() - startedAt, outcome: 'reject' }); },
          );
        } catch {}
      }
      return result;
    };
  }

  return {
    getSnapshot() {
      try { for (const entry of longTaskObserver?.takeRecords?.() || []) recordLongTask(entry); } catch {}
      const measures = [];
      try {
        for (const entry of target.performance.getEntriesByType('mark')) {
          if (entry.name.startsWith('reclass-610-')) measures.push({ type: 'mark', name: entry.name, startTime: entry.startTime });
        }
        for (const entry of target.performance.getEntriesByType('measure')) {
          if (entry.name.startsWith('reclass-610-')) measures.push({ type: 'measure', name: entry.name, durationMs: entry.duration });
        }
      } catch {}
      return { captureLabel, captureMark, capturedAt, applyCapturedAt: captureLabel === 'Apply' ? capturedAt : null,
        longTaskSupported, records: records.slice(), userTiming: measures };
    },
    restore() {
      target.document.removeEventListener('click', captureApply, true);
      try { longTaskObserver?.disconnect(); } catch {}
      for (const [name, original] of originalFunctions) target[name] = original;
      return true;
    },
    missing: missing.slice(),
  };
}
