/** Reproducible non-cryptographic randomness for the isolated browser fixture. */
export function installPerformanceRandomFixture(seed, root = globalThis) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff || typeof root.Math?.random !== 'function') {
    throw new Error('PERFORMANCE_RANDOM_SEED_INVALID');
  }
  if (Object.hasOwn(root, '__phase6RandomFixture')) throw new Error('PERFORMANCE_RANDOM_FIXTURE_ALREADY_INSTALLED');
  let state = seed >>> 0;
  let calls = 0;
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
  const evidence = Object.freeze({ getState: () => ({ algorithm: 'mulberry32-v1', seed, calls }) });
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
