import { Component, lazy, Suspense, useState, type ErrorInfo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HistoricalRequestsBridge } from './contract';

export { createHistoricalRequestsBridge } from '../../services/historicalRequests';

const VIEW_CHUNK_URL = '__HISTORICAL_REQUESTS_VIEW_CHUNK_URL__';
const loadView = (retry = 0) => {
  const url = new URL(VIEW_CHUNK_URL, import.meta.url);
  if (retry > 0) url.searchParams.set('retry', String(retry));
  return import(url.href).then(module => {
    if (!module || typeof module.HistoricalRequestsView !== 'function') throw new Error('Historical Requests view module is incomplete.');
    return { default: module.HistoricalRequestsView as typeof import('./HistoricalRequestsView').HistoricalRequestsView };
  });
};
const InitialHistoricalRequestsView = lazy(() => loadView());

class HistoricalRequestsLoadBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) {}
  render() {
    if (this.state.failed) return <div className="historical-requests__state historical-requests__state--error" role="alert">
      Historical Requests could not load. Your saved data is unchanged.
      <button type="button" onClick={this.props.onRetry}>Retry loading history</button>
    </div>;
    return this.props.children;
  }
}

function RecoverableHistoricalRequestsView({ bridge }: { bridge: HistoricalRequestsBridge }) {
  const [generation, setGeneration] = useState(0);
  const [View, setView] = useState(() => InitialHistoricalRequestsView);
  const retry = () => {
    setView(lazy(() => loadView(generation + 1)));
    setGeneration(value => value + 1);
  };
  return <HistoricalRequestsLoadBoundary key={generation} onRetry={retry}>
    <Suspense fallback={<div className="historical-requests__state" role="status">Loading Historical Requests…</div>}>
      <View key={JSON.stringify([bridge.scopeKey, bridge.role])} bridge={bridge} />
    </Suspense>
  </HistoricalRequestsLoadBoundary>;
}

export type HistoricalRequestsMount = { update(bridge: HistoricalRequestsBridge): void; destroy(): void };

export function mountHistoricalRequests(host: HTMLElement, bridge: HistoricalRequestsBridge): HistoricalRequestsMount {
  let root: Root | null = createRoot(host);
  let destroyed = false;
  const render = (nextBridge: HistoricalRequestsBridge) => {
    if (!root || destroyed) return;
    root.render(<RecoverableHistoricalRequestsView key={JSON.stringify([nextBridge.scopeKey, nextBridge.role])} bridge={nextBridge} />);
  };
  render(bridge);
  return {
    update(nextBridge) {
      if (host.isConnected) render(nextBridge);
      else this.destroy();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root?.unmount();
      root = null;
      host.replaceChildren();
    },
  };
}
