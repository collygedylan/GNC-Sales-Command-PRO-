(function installQueueCompletion(root) {
  'use strict';
  /** @param {{scope:string, storage?:Pick<Storage, 'getItem'|'setItem'>}} options */
  function create({ scope, storage }) {
    const key = `agmetric:queue-completions:v1:${scope}`;
    const pending = new Set();
    const confirmed = new Set();
    try {
      const saved = JSON.parse(storage?.getItem(key) || '[]');
      if (Array.isArray(saved)) for (const id of saved) if (typeof id === 'string' && id.length < 512) confirmed.add(id);
    } catch { /* Storage is optional; the session still protects optimistic rows. */ }
    return Object.freeze({
      /** @param {string} id */
      begin(id) {
        if (!id || pending.has(id) || confirmed.has(id)) return false;
        pending.add(id); return true;
      },
      /** @param {string} id */
      has(id) { return pending.has(id) || confirmed.has(id); },
      /** @param {string} id */
      confirm(id) {
        if (!id) return;
        pending.delete(id); confirmed.add(id);
        // Only confirmed identities are durable. No row data or unfinished writes.
        try { storage?.setItem(key, JSON.stringify([...confirmed])); } catch { /* Keep session receipt. */ }
      },
      /** @param {string} id */
      rollback(id) { pending.delete(id); }
    });
  }
  root.AgMetricQueueCompletion = Object.freeze({ create });
})(window);
