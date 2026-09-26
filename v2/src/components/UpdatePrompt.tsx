import { useRegisterSW } from 'virtual:pwa-register/react';
import { APP_VERSION } from '../services/api';

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('[v2:pwa] service worker registration failed', error);
    }
  });

  // The informational offline toast covered embedded form actions on phones.
  // Only actionable updates warrant an overlay; caching still runs normally.
  if (!needRefresh) return null;

  return (
    <aside className="pwa-update-banner" role="status" aria-live="polite">
      <div>
        <strong>{needRefresh ? 'Update ready' : 'Test shell available offline'}</strong>
        <span>{needRefresh ? `${APP_VERSION} is ready. Apply it when your current work is saved.` : 'Only the test shell is cached. BloomScapes inventory and orders require an internet connection.'}</span>
      </div>
      <div className="pwa-update-actions">
        {needRefresh ? (
          <button type="button" onClick={() => void updateServiceWorker(true)}>Update</button>
        ) : null}
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setNeedRefresh(false);
            setOfflineReady(false);
          }}
        >
          Dismiss
        </button>
      </div>
    </aside>
  );
}
