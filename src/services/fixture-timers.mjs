import { afterEach } from 'node:test';

const active = new Set();
export const fixtureTimers = {
  setTimeout(callback, delay, ...args) {
    const timer = setTimeout(() => {
      active.delete(timer);
      callback(...args);
    }, delay);
    active.add(timer);
    return timer;
  },
  clearTimeout(timer) {
    active.delete(timer);
    clearTimeout(timer);
  },
};
afterEach(() => {
  for (const timer of active) clearTimeout(timer);
  active.clear();
});
