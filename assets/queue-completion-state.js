(function installQueueCompletion(root) {
  'use strict';
  /** @param {{scope:string, storage?:Pick<Storage, 'getItem'|'setItem'>}} options */
  function create({ scope, storage }) {
    const key = `agmetric:queue-completions:v1:${scope}`;
    const pending = new Set();
    const confirmed = new Map();
    try {
      const saved = JSON.parse(storage?.getItem(key) || '[]');
      if (Array.isArray(saved)) for (const entry of saved) {
        const [id, version] = Array.isArray(entry) ? entry : [entry, 0];
        if (typeof id === 'string' && id.length < 512) confirmed.set(id, Number(version) || 0);
      }
    } catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'create'); /* Storage is optional; the session still protects optimistic rows. */ }
    return Object.freeze({
      /** @param {string} id @param {number} [version] */
      begin(id, version = 0) {
        if (!id || pending.has(id) || (confirmed.has(id) && !(version > confirmed.get(id) && confirmed.get(id) > 0))) return false;
        confirmed.delete(id);
        pending.add(id); return true;
      },
      /** A later server version can explicitly reopen work; stale reads cannot.
       * @param {string} id @param {number} [version] */
      has(id, version = 0) {
        if (pending.has(id)) return true;
        const acknowledged = confirmed.get(id);
        return acknowledged !== undefined && !(version > acknowledged && acknowledged > 0);
      },
      /** @param {string} id @param {number} [version] */
      confirm(id, version = 0) {
        if (!id) return;
        pending.delete(id); confirmed.set(id, Number(version) || 0);
        // Only confirmed identities are durable. No row data or unfinished writes.
        try { storage?.setItem(key, JSON.stringify([...confirmed])); } catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'create'); /* Keep session receipt. */ }
      },
      /** @param {string} id */
      rollback(id) { pending.delete(id); }
    });
  }
  root.AgMetricQueueCompletion = Object.freeze({ create });
})(window);
