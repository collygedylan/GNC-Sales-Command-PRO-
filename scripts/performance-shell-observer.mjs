/** Observe deferred shell callbacks without replacing the app's scheduler. */
export function installPerformanceShellObserver(root = globalThis) {
  if (root.__phase6ShellObserver) return root.__phase6ShellObserver;
  const original = root.runAfterShellInteractive;
  if (typeof original !== 'function') throw new Error('PERFORMANCE_SHELL_SCHEDULER_MISSING');
  const pending = new Set();
  const observer = Object.freeze({
    getPendingActivity: () => Object.freeze({ pending: pending.size > 0, callbacks: pending.size })
  });
  root.runAfterShellInteractive = function (task, ...args) {
    if (typeof task !== 'function') return original.call(this, task, ...args);
    const token = {};
    pending.add(token);
    const observedTask = function (...callbackArgs) {
      try { return task.apply(this, callbackArgs); }
      finally { pending.delete(token); }
    };
    try { return original.call(this, observedTask, ...args); }
    catch (error) { pending.delete(token); throw error; }
  };
  Object.defineProperty(root, '__phase6ShellObserver', { value: observer, enumerable: false, configurable: false });
  return observer;
}
