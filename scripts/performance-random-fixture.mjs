/** Reproducible non-cryptographic randomness for the isolated browser fixture. */
export function installPerformanceRandomFixture(seed, root = globalThis) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff || typeof root.Math?.random !== 'function') {
    throw new Error('PERFORMANCE_RANDOM_SEED_INVALID');
  }
  if (Object.hasOwn(root, '__phase6RandomFixture')) throw new Error('PERFORMANCE_RANDOM_FIXTURE_ALREADY_INSTALLED');
  let state = seed >>> 0;
  let calls = 0;
  const healthStreams = new Map();
  let healthDraws = 0;
  let healthSamples = 0;
  const maxHealthStreams = 64;

  const nextMulberry = stream => {
    stream.state = (stream.state + 0x6D2B79F5) >>> 0;
    let value = stream.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const healthSeed = key => {
    const identity = `health-event-area-reason-v1:${seed}:${key}`;
    let value = 2166136261;
    for (const character of identity) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0;
    return value;
  };
  const nextHealthSample = args => {
    const eventName = String(args[0] || 'performance_trace').slice(0, 120);
    const area = String(args[1] || 'app').slice(0, 80);
    const metadata = args[3] && typeof args[3] === 'object' && !Array.isArray(args[3]) ? args[3] : null;
    const reason = typeof metadata?.reason === 'string' ? metadata.reason.slice(0, 120) : '';
    const key = JSON.stringify([eventName, area, reason]);
    let stream = healthStreams.get(key);
    if (!stream) {
      if (healthStreams.size >= maxHealthStreams) throw new Error('PERFORMANCE_HEALTH_STREAM_LIMIT');
      stream = { state: healthSeed(key), calls: 0 };
      healthStreams.set(key, stream);
    }
    const draw = nextMulberry(stream);
    stream.calls++;
    healthDraws++;
    if (draw < 0.10) healthSamples++;
    return draw;
  };

  // Mulberry32: same seed and call sequence on both revisions. Only Math.random
  // changes; native crypto, clocks, timers and telemetry handlers remain intact.
  root.Math.random = () => {
    calls++;
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const wrapHealthReporter = handler => {
    if (typeof handler !== 'function') throw new Error('PERFORMANCE_HEALTH_HANDLER_INVALID');
    const handlerSource = Function.prototype.toString.call(handler).replace(/\s+/g, '');
    const signature = /^functionreportPerformanceHealthEvent\(eventName,area=(?:"app"|'app'),durationMs=0,metadata=\{\}\)\{/;
    const signatureMatch = handlerSource.match(signature);
    const body = signatureMatch ? handlerSource.slice(signatureMatch[0].length) : '';
    const gate = /^if\(!currentUser\|\|navigator\.onLine===false\|\|Math\.random\(\)>=(?:0\.10|0\.1|\.1)\)returnPromise\.resolve\(false\);/;
    const randomCalls = handlerSource.match(/\bMath\.random\(\)/g) || [];
    if (!signatureMatch || !gate.test(body) || randomCalls.length !== 1) {
      throw new Error('PERFORMANCE_HEALTH_REPORTER_CONTRACT_INVALID');
    }
    return function performanceHealthRandomIsolated(...args) {
      const originalRandom = root.Math.random;
      let intercepted = false;
      const scopedRandom = function performanceHealthSamplingRandom(...randomArgs) {
        if (intercepted) return originalRandom.apply(this, randomArgs);
        intercepted = true;
        const globalDraw = originalRandom.apply(this, randomArgs);
        // Preserve the original global RNG draw and restore it before the
        // reporter constructs or sends its RPC payload.
        root.Math.random = originalRandom;
        void globalDraw;
        return nextHealthSample(args);
      };
      root.Math.random = scopedRandom;
      try {
        return handler.apply(this, args);
      } finally {
        if (root.Math.random === scopedRandom) root.Math.random = originalRandom;
      }
    };
  };
  const evidence = Object.freeze({
    getState: () => ({ algorithm: 'mulberry32-v1', seed, calls,
      healthSampling: { algorithm: 'mulberry32-event-area-reason-v1', seed, calls: healthDraws,
        sampled: healthSamples, streams: healthStreams.size, maxStreams: maxHealthStreams } }),
    wrapHealthReporter,
    healthReporterContract: 'first-random-is-10-percent-gate-v1'
  });
  Object.defineProperty(root, '__phase6RandomFixture', { value: evidence, enumerable: false });
  return evidence;
}

export function performanceRandomSeed(profile, app, iteration) {
  if (!['phone', 'tablet', 'desktop'].includes(profile) || !['live', 'v2'].includes(app)
      || !Number.isInteger(iteration) || iteration < 0) throw new Error('PERFORMANCE_RANDOM_SAMPLE_INVALID');
  const identity = `que-drive-random-v1:${profile}:${app}:${iteration}`;
  let seed = 2166136261;
  for (const character of identity) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
  return seed;
}
