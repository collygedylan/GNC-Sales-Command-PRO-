const TIMELINE_CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'blink.user_timing',
].join(',');

const SIGNIFICANT_EVENT_NAMES = [
  'EventDispatch', 'UpdateLayoutTree', 'RecalculateStyles', 'Layout', 'PrePaint', 'Paint',
];

function getEventName(event) {
  const details = event?.args?.data || {};
  return String(event?.name || details.name || '');
}

function getApplyMarkTime(events) {
  const mark = events.find(event => getEventName(event) === 'UserTiming'
    && String(event?.args?.data?.name || event?.args?.data?.message || '') === 'reclass-610-apply-captured');
  if (Number.isFinite(mark?.ts)) return mark.ts;
  const click = events.find(event => getEventName(event) === 'EventDispatch'
    && String(event?.args?.data?.type || '') === 'click');
  return Number.isFinite(click?.ts) ? click.ts : null;
}

export function summarizeReclassCdpTrace(events) {
  const applyTs = getApplyMarkTime(events);
  if (applyTs == null) return { applyMarkFound: false, significantEvents: [] };
  const significantEvents = events
    .filter(event => SIGNIFICANT_EVENT_NAMES.includes(getEventName(event)) && Number.isFinite(event?.ts) && event.ts >= applyTs)
    .map(event => ({
      name: getEventName(event),
      sinceApplyMs: Math.max(0, (event.ts - applyTs) / 1000),
      durationMs: Math.max(0, Number(event.dur || 0) / 1000),
      phase: String(event.ph || ''),
      eventType: String(event?.args?.data?.type || ''),
    }))
    .sort((left, right) => right.durationMs - left.durationMs);
  return {
    applyMarkFound: true,
    significantEventCount: significantEvents.length,
    longestSignificantEvents: significantEvents.slice(0, 40),
  };
}

async function readTraceStream(session, stream) {
  let raw = '';
  let eof = false;
  while (!eof) {
    const chunk = await session.send('IO.read', { handle: stream, size: 1_048_576 });
    raw += String(chunk.data || '');
    eof = chunk.eof === true;
  }
  await session.send('IO.close', { handle: stream });
  return raw;
}

/**
 * Start an opt-in, Chromium-only DevTools timeline capture. The helper is
 * diagnostic and must never make the Reclass workflow itself fail.
 */
export async function startReclassCdpTimeline(page, env = process.env) {
  if (env.GNC_RECLASS_TIMELINE !== '1' || page.context().browser()?.browserType().name() !== 'chromium') return null;
  let session;
  let completion;
  let started = false;
  let stopped = false;
  let startError = '';
  try {
    session = await page.context().newCDPSession(page);
    completion = new Promise(resolve => session.once('Tracing.tracingComplete', resolve));
    await session.send('Tracing.start', { categories: TIMELINE_CATEGORIES, transferMode: 'ReturnAsStream', streamFormat: 'json' });
    started = true;
  } catch (error) {
    startError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    try { await session?.detach(); } catch {}
  }
  return {
    async stop() {
      if (stopped) return { startError, stopError: '', rawTrace: '', summary: { applyMarkFound: false, significantEvents: [] } };
      stopped = true;
      let stopError = '';
      let rawTrace = '';
      try {
        if (started && session && completion) {
          await session.send('Tracing.end');
          const result = await completion;
          if (result.stream) rawTrace = await readTraceStream(session, result.stream);
          else if (Array.isArray(result.traceEvents)) rawTrace = JSON.stringify({ traceEvents: result.traceEvents });
        }
      } catch (error) {
        stopError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      } finally {
        try { await session?.detach(); } catch {}
      }
      let summary = { applyMarkFound: false, significantEvents: [] };
      try {
        const trace = JSON.parse(rawTrace);
        summary = summarizeReclassCdpTrace(Array.isArray(trace.traceEvents) ? trace.traceEvents : []);
      } catch (error) {
        if (rawTrace && !stopError) stopError = error instanceof Error ? `Trace parse failed: ${error.message}` : 'Trace parse failed';
      }
      return { startError, stopError, rawTrace, summary };
    },
  };
}
