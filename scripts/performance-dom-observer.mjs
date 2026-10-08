/** Observe route removals from stable roots, retaining ownership after detach. */
export function installPerformanceDomRemovalObserver(root = globalThis) {
  const key = '__phase6DomRemovalObserver';
  if (root[key]) return root[key];
  const document = root.document;
  const MutationObserverClass = root.MutationObserver;
  if (!document || typeof MutationObserverClass !== 'function') throw new Error('PERFORMANCE_DOM_OBSERVER_UNAVAILABLE');

  const counts = new Map([['request', 0], ['drive', 0]]);
  const observers = new Set();
  const owners = new WeakMap();
  const observedElements = new WeakMap();
  const observerMetadata = new Map();
  let v2Root = null;
  let rootWaiter = null;
  const markTree = (node, inheritedView = null) => {
    if (!node || node.nodeType !== 1) return;
    const view = node.id === 'request-content' || node.matches('.request-list') ? 'request'
      : node.id === 'drive-content' || node.matches('.drive-item-list') ? 'drive' : inheritedView;
    if (view) owners.set(node, view);
    for (const child of node.children) markTree(child, view);
  };
  const processRecords = (records, metadata) => {
    for (const record of records) {
      const recordView = metadata.view === 'discovery' ? (owners.get(record.target) || null) : metadata.view;
      if (recordView) counts.set(recordView, (counts.get(recordView) || 0) + record.removedNodes.length);
      if (metadata.discoverV2) {
        for (const added of record.addedNodes) markTree(added, recordView);
      }
    }
  };
  const observe = (element, view, { discoverV2 = false } = {}) => {
    if (!element || observedElements.has(element)) return;
    markTree(element, view === 'discovery' ? null : view);
    const metadata = { view, discoverV2, element };
    const observer = new MutationObserverClass(records => {
      processRecords(records, metadata);
    });
    observer.observe(element, { childList: true, subtree: true });
    observers.add(observer);
    observedElements.set(element, observer);
    observerMetadata.set(observer, metadata);
    return observer;
  };
  const attachRoots = () => {
    const request = document.querySelector('#request-content');
    const drive = document.querySelector('#drive-content');
    const main = document.querySelector('main.main-scroll');
    for (const [observer, metadata] of observerMetadata) {
      const isOwnedRouteRoot = metadata.view === 'request' || metadata.view === 'drive';
      const obsolete = !metadata.element.isConnected
        || (metadata.view === 'discovery' && metadata.element !== main);
      if (!obsolete || (!isOwnedRouteRoot && metadata.view !== 'discovery')) continue;
      processRecords(observer.takeRecords(), metadata);
      observer.disconnect();
      observers.delete(observer);
      observerMetadata.delete(observer);
      observedElements.delete(metadata.element);
    }
    if (request && !main?.contains(request)) observe(request, 'request');
    if (drive && !main?.contains(drive)) observe(drive, 'drive');
    if (main && main !== v2Root) {
      v2Root = main;
      observe(main, 'discovery', { discoverV2: true });
    }
    if (request || drive || main) {
      rootWaiter?.disconnect();
      rootWaiter = null;
    }
  };
  rootWaiter = new MutationObserverClass(attachRoots);
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    attachRoots();
    if (!rootWaiter) return;
    rootWaiter.observe(document.body || document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  const flush = () => {
    attachRoots();
    for (const observer of observers) {
      const metadata = observerMetadata.get(observer);
      if (metadata) processRecords(observer.takeRecords(), metadata);
    }
  };
  const api = Object.freeze({
    reset(view) {
      if (view !== 'request' && view !== 'drive') throw new Error('PERFORMANCE_DOM_VIEW_INVALID');
      flush();
      counts.set(view, 0);
    },
    snapshot(view) {
      if (view !== 'request' && view !== 'drive') throw new Error('PERFORMANCE_DOM_VIEW_INVALID');
      flush();
      return Object.freeze({ domRemovals: counts.get(view) || 0 });
    }
  });
  Object.defineProperty(root, key, { configurable: false, enumerable: false, value: api });
  return api;
}

/** A poll remains scheduled normally; this only reports whether it is near. */
export function isPerformancePollWindowReady(activity, headroomMs) {
  if (!activity || activity.pending !== false || !Number.isFinite(headroomMs) || headroomMs < 0) return false;
  if (activity.persistentPollTimers === 0) return true;
  return Number.isFinite(activity.nextPersistentPollInMs) && activity.nextPersistentPollInMs > headroomMs;
}
