/** Collect full long-task entries, then attribute by their timestamped sample window. */
export function installPerformanceLongTaskObserver(root = globalThis) {
  const key = '__phase6LongTaskObserver';
  if (root[key]) return root[key];
  const records = [];
  let observer = null;
  const collect = entries => {
    for (const entry of entries || []) {
      if (Number.isFinite(entry?.startTime) && Number.isFinite(entry?.duration) && entry.duration >= 0) {
        records.push({ startTime: entry.startTime, duration: entry.duration });
      }
    }
  };
  const takePending = () => {
    if (observer && typeof observer.takeRecords === 'function') collect(observer.takeRecords());
  };
  if (root.PerformanceObserver?.supportedEntryTypes?.includes('longtask')) {
    observer = new root.PerformanceObserver(list => collect(list.getEntries()));
    observer.observe({ type: 'longtask' });
  }
  const api = Object.freeze({
    begin() {
      takePending();
      return root.performance.now();
    },
    finish(startTime) {
      if (!Number.isFinite(startTime)) throw new Error('PERFORMANCE_LONGTASK_START_INVALID');
      takePending();
      const endTime = root.performance.now();
      let longTaskMs = 0;
      const keep = [];
      for (const entry of records) {
        if (entry.startTime >= startTime && entry.startTime < endTime) longTaskMs += entry.duration;
        else if (entry.startTime >= endTime) keep.push(entry);
      }
      records.splice(0, records.length, ...keep);
      return Object.freeze({ longTaskMs });
    }
  });
  Object.defineProperty(root, key, { configurable: false, enumerable: false, value: api });
  return api;
}
