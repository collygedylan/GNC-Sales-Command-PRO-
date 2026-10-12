import { useRegisterSW } from 'virtual:pwa-register/react';
import { useEffect, useRef, useState } from 'react';

const UPDATE_POLL_INTERVAL_MS = 5 * 60_000;
const UPDATE_TOAST_MS = 700;
const reloadWindow = () => window.location.reload();

export function UpdatePrompt({ reloadPage = reloadWindow }: { reloadPage?: () => void } = {}) {
  const controllerObservedRef = useRef(false);
  const updateRequestedRef = useRef(false);
  const reloadStartedRef = useRef(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, registered) {
      if (!registered) return;
      setRegistration(registered);
      if (navigator.onLine !== false && document.visibilityState !== 'hidden') {
        void registered.update().catch(() => {});
      }
    },
    // The component's controllerchange listener owns the toast and reload.
    // Supplying this callback prevents the adapter from reloading separately.
    onNeedReload() {},
    onRegisterError(error) {
      console.error('[v2:pwa] service worker registration failed', error);
    }
  });

  useEffect(() => {
    if (!needRefresh || updateRequestedRef.current) return;
    updateRequestedRef.current = true;
    setIsUpdating(true);
    // In prompt mode the adapter sends SKIP_WAITING. The supplied onNeedReload
    // callback suppresses its reload so controllerchange owns the reload.
    void updateServiceWorker(false).catch(error => {
      updateRequestedRef.current = false;
      setIsUpdating(false);
      console.error('[v2:pwa] service worker activation failed', error);
    });
  }, [needRefresh, updateServiceWorker]);

  useEffect(() => {
    if (!registration) return;
    const poll = () => {
      if (navigator.onLine === false || document.visibilityState === 'hidden') return;
      void registration.update().catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') poll();
    };
    const timer = window.setInterval(poll, UPDATE_POLL_INTERVAL_MS);
    window.addEventListener('focus', poll);
    window.addEventListener('online', poll);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', poll);
      window.removeEventListener('online', poll);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [registration]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    controllerObservedRef.current = Boolean(navigator.serviceWorker.controller);
    let reloadTimer: number | null = null;
    const onControllerChange = () => {
      if (!controllerObservedRef.current) {
        // The first install can claim this page; it is already loading the new app.
        controllerObservedRef.current = true;
        return;
      }
      if (reloadStartedRef.current) return;
      reloadStartedRef.current = true;
      setIsUpdating(true);
      // v2's screen filters are in-memory React state, so reload clears stale
      // filter selections while leaving durable preferences and offline data intact.
      reloadTimer = window.setTimeout(reloadPage, UPDATE_TOAST_MS);
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      if (reloadTimer != null) window.clearTimeout(reloadTimer);
    };
  }, [reloadPage]);

  if (isUpdating) {
    return (
      <aside className="pwa-update-banner" role="status" aria-live="polite">
        <div><strong>New version detected. Updating...</strong></div>
      </aside>
    );
  }

  return null;
}
