import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { App } from './App';
import { APP_VERSION } from './services';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false
    },
    mutations: { retry: 0 }
  }
});

function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('[v2:pwa] service worker registration failed', error);
    }
  });

  if (!needRefresh && !offlineReady) return null;

  return (
    <aside className="pwa-update-banner" role="status" aria-live="polite">
      <div>
        <strong>{needRefresh ? 'Update ready' : 'Available offline'}</strong>
        <span>{needRefresh ? `${APP_VERSION} is ready. Apply it when your current work is saved.` : 'The test app is cached for field use.'}</span>
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

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <QueryClientProvider client={queryClient}>
        <App />
        <UpdatePrompt />
      </QueryClientProvider>
    </HashRouter>
  </React.StrictMode>
);
