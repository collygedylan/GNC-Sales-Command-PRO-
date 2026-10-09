/** Observe the legacy shell's one-shot background-login validation without changing its schedule. */
export function installPerformanceLoginValidationObserver(root = globalThis, scheduleFunction = null) {
  const observerKey = '__phase6LoginValidationObserver';
  if ((typeof root !== 'object' && typeof root !== 'function') || root === null) throw new Error('PERFORMANCE_LOGIN_VALIDATION_ROOT_MISSING');
  if (typeof root.setTimeout !== 'function') throw new Error('PERFORMANCE_LOGIN_VALIDATION_SCHEDULER_MISSING');
  if (Object.hasOwn(root, observerKey)) throw new Error('PERFORMANCE_LOGIN_VALIDATION_OBSERVER_ALREADY_INSTALLED');

  const originalSchedule = scheduleFunction || root.scheduleBackgroundLoginValidation;
  if (typeof originalSchedule !== 'function') throw new Error('PERFORMANCE_LOGIN_VALIDATION_FUNCTION_MISSING');
  const compactSource = Function.prototype.toString.call(originalSchedule).replace(/\s+/g, '');
  const timerCalls = compactSource.match(/\bsetTimeout\(/g) || [];
  const hasExpectedDelay = /(?:,|:)2200(?:[,);])/.test(compactSource);
  const hasExpectedRefresh = /refreshNativeRoleAndCapabilities\((['"])background-validation\1\)/.test(compactSource);
  if (timerCalls.length !== 1 || !hasExpectedRefresh || !hasExpectedDelay) {
    throw new Error('PERFORMANCE_LOGIN_VALIDATION_SOURCE_INVALID');
  }

  const pending = new Set();
  const state = {
    calls: 0,
    scheduled: 0,
    running: 0,
    settled: 0,
    earlyReturns: 0,
    schedulingFailures: 0,
    contractValid: true,
  };

  const observer = Object.freeze({
    getPendingActivity() {
      return Object.freeze({
        pending: pending.size > 0,
        calls: state.calls,
        scheduled: state.scheduled,
        running: state.running,
        settled: state.settled,
        earlyReturns: state.earlyReturns,
        schedulingFailures: state.schedulingFailures,
        contractValid: state.contractValid,
        pendingTimers: Object.freeze(Array.from(pending, timer => Object.freeze({ delayMs: timer.delayMs, state: timer.state }))),
      });
    },
    wrap(schedule = originalSchedule) {
      if (typeof schedule !== 'function' || Function.prototype.toString.call(schedule).replace(/\s+/g, '') !== compactSource) {
        throw new Error('PERFORMANCE_LOGIN_VALIDATION_FUNCTION_MISMATCH');
      }
      return function observedScheduleBackgroundLoginValidation(...args) {
        state.calls++;
        const originalSetTimeout = root.setTimeout;
        const descriptor = Object.getOwnPropertyDescriptor(root, 'setTimeout');
        let interceptedCalls = 0;
        const scopedSetTimeout = function (callback, delay, ...timerArgs) {
          interceptedCalls++;
          if (interceptedCalls !== 1 || delay !== 2200 || typeof callback !== 'function') {
            state.contractValid = false;
            return originalSetTimeout.call(this, callback, delay, ...timerArgs);
          }

          const timer = { delayMs: delay, state: 'scheduled' };
          pending.add(timer);
          state.scheduled++;
          const finish = () => {
            if (!pending.delete(timer)) return;
            if (timer.state === 'running') state.running--;
            state.settled++;
          };
          const observedCallback = function (...callbackArgs) {
            timer.state = 'running';
            state.running++;
            let result;
            try {
              result = callback.apply(this, callbackArgs);
            } catch (error) {
              finish();
              throw error;
            }
            if (result && typeof result.then === 'function') Promise.resolve(result).then(finish, finish);
            else finish();
            return result;
          };
          try {
            return originalSetTimeout.call(this, observedCallback, delay, ...timerArgs);
          } catch (error) {
            pending.delete(timer);
            state.scheduled--;
            state.schedulingFailures++;
            throw error;
          }
        };

        let result;
        try {
          root.setTimeout = scopedSetTimeout;
          result = schedule.apply(this, args);
        } finally {
          if (descriptor) Object.defineProperty(root, 'setTimeout', descriptor);
          else delete root.setTimeout;
        }
        if (interceptedCalls === 0) state.earlyReturns++;
        return result;
      };
    },
  });

  Object.defineProperty(root, observerKey, { configurable: false, enumerable: false, value: observer });
  return observer;
}
