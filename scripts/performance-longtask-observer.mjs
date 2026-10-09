/** Collect full long-task entries, then attribute by their timestamped sample window. */
export function installPerformanceLongTaskObserver(root = globalThis) {
  const key = '__phase6LongTaskObserver';
  if (root[key]) return root[key];
  const records = [];
  const diagnosticLongTasks = [];
  const animationFrames = [];
  const windows = [];
  const maxDiagnosticEntries = 128;
  let droppedLongTasks = 0;
  let droppedAnimationFrames = 0;
  let droppedWindows = 0;
  let droppedScripts = 0;
  let observer = null;
  let animationFrameObserver = null;
  const supportedTypes = root.PerformanceObserver?.supportedEntryTypes || [];
  const sanitizePath = value => {
    if (typeof value !== 'string' || !value) return '';
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      return parsed.pathname.slice(0, 512);
    } catch {
      return '';
    }
  };
  const sanitizeInvoker = value => {
    if (typeof value !== 'string') return '';
    if (/^[a-z][a-z\d+.-]*:/i.test(value) || /[?#]/.test(value)) return sanitizePath(value);
    return /^(?:Window|DedicatedWorkerGlobalScope|WorkerGlobalScope|Document|XMLHttpRequest)(?:\.[A-Za-z_$][\w$]*){0,4}$/.test(value)
      ? value.slice(0, 256) : '';
  };
  const appendBounded = (target, value, dropped) => {
    if (target.length >= maxDiagnosticEntries) {
      target.shift();
      dropped();
    }
    target.push(value);
  };
  const collect = entries => {
    for (const entry of entries || []) {
      if (Number.isFinite(entry?.startTime) && Number.isFinite(entry?.duration) && entry.duration >= 0) {
        const record = { startTime: entry.startTime, duration: entry.duration };
        records.push(record);
        appendBounded(diagnosticLongTasks, record, () => { droppedLongTasks++; });
      }
    }
  };
  const collectAnimationFrames = entries => {
    for (const entry of entries || []) {
      if (!Number.isFinite(entry?.startTime) || !Number.isFinite(entry?.duration) || entry.duration < 0) continue;
      const scripts = [];
      if (Array.isArray(entry.scripts)) {
        droppedScripts += Math.max(0, entry.scripts.length - 16);
        for (const script of entry.scripts.slice(0, 16)) {
          scripts.push({
            startTime: Number.isFinite(script?.startTime) ? script.startTime : null,
            duration: Number.isFinite(script?.duration) ? script.duration : null,
            executionStart: Number.isFinite(script?.executionStart) ? script.executionStart : null,
            invokerType: typeof script?.invokerType === 'string' ? script.invokerType.slice(0, 128) : '',
            invoker: sanitizeInvoker(script?.invoker),
            sourceFunctionName: typeof script?.sourceFunctionName === 'string' ? script.sourceFunctionName.slice(0, 256) : '',
            sourceURL: sanitizePath(script?.sourceURL),
            sourceCharPosition: Number.isFinite(script?.sourceCharPosition) ? script.sourceCharPosition : null,
            forcedStyleAndLayoutDuration: Number.isFinite(script?.forcedStyleAndLayoutDuration)
              ? script.forcedStyleAndLayoutDuration : null
          });
        }
      }
      appendBounded(animationFrames, {
        startTime: entry.startTime,
        duration: entry.duration,
        blockingDuration: Number.isFinite(entry.blockingDuration) ? entry.blockingDuration : null,
        renderStart: Number.isFinite(entry.renderStart) ? entry.renderStart : null,
        styleAndLayoutStart: Number.isFinite(entry.styleAndLayoutStart) ? entry.styleAndLayoutStart : null,
        scripts
      }, () => { droppedAnimationFrames++; });
    }
  };
  const takePending = () => {
    if (observer && typeof observer.takeRecords === 'function') collect(observer.takeRecords());
    if (animationFrameObserver && typeof animationFrameObserver.takeRecords === 'function') {
      collectAnimationFrames(animationFrameObserver.takeRecords());
    }
  };
  if (supportedTypes.includes('longtask')) {
    observer = new root.PerformanceObserver(list => collect(list.getEntries()));
    observer.observe({ type: 'longtask' });
  }
  let longAnimationFrameSupported = false;
  if (supportedTypes.includes('long-animation-frame')) {
    try {
      animationFrameObserver = new root.PerformanceObserver(list => collectAnimationFrames(list.getEntries()));
      animationFrameObserver.observe({ type: 'long-animation-frame' });
      longAnimationFrameSupported = true;
    } catch {
      animationFrameObserver = null;
    }
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
      appendBounded(windows, { startTime, endTime, longTaskMs }, () => { droppedWindows++; });
      return Object.freeze({ longTaskMs });
    },
    getDiagnostics() {
      takePending();
      return Object.freeze({
        longAnimationFrameSupported,
        windows: windows.map(window => Object.freeze({ ...window })),
        longTasks: diagnosticLongTasks.map(entry => Object.freeze({ ...entry })),
        animationFrames: animationFrames.map(entry => Object.freeze({
          ...entry,
          scripts: entry.scripts.map(script => Object.freeze({ ...script }))
        })),
        dropped: Object.freeze({ longTasks: droppedLongTasks, animationFrames: droppedAnimationFrames,
          windows: droppedWindows, scripts: droppedScripts })
      });
    }
  });
  Object.defineProperty(root, key, { configurable: false, enumerable: false, value: api });
  return api;
}
