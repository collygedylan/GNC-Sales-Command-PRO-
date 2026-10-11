import { Component, lazy, Suspense, useState, type ErrorInfo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FieldCountingBridge } from './contract';
import { createFieldCountingBridge } from '../../services/fieldCounting';

export { createFieldCountingBridge };

export type FieldCountingMount = {
  update(bridge: FieldCountingBridge, onExit?: () => void): void;
  destroy(): void;
};

const VIEW_CHUNK_URL = '__FIELD_COUNTING_VIEW_CHUNK_URL__';
const loadCountingView = (retry = 0) => {
  const url = new URL(VIEW_CHUNK_URL, import.meta.url);
  if (retry > 0) url.searchParams.set('retry', String(retry));
  return import(url.href).then(module => {
    if (!module || typeof module.FieldCountingView !== 'function') throw new Error('Counting view module is incomplete.');
    return { default: module.FieldCountingView as typeof import('./FieldCountingView').FieldCountingView };
  });
};
const InitialCountingView = lazy(() => loadCountingView());

class CountingLoadBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) {}
  render() {
    if (this.state.failed) return <div className="field-counting__notice field-counting__notice--error" role="alert">
      Counting could not load. Your saved counts are unchanged.
      <button type="button" onClick={this.props.onRetry}>Retry loading counts</button>
    </div>;
    return this.props.children;
  }
}

function RecoverableCountingView({ bridge, onExit }: { bridge: FieldCountingBridge; onExit?: () => void }) {
  const [generation, setGeneration] = useState(0);
  const [View, setView] = useState(() => InitialCountingView);
  const retry = () => {
    setView(lazy(() => loadCountingView(generation + 1)));
    setGeneration(value => value + 1);
  };
  return <CountingLoadBoundary key={generation} onRetry={retry}>
    <Suspense fallback={<div className="field-counting__empty" role="status">Loading counting tools…</div>}>
      <View bridge={bridge} onExit={onExit} />
    </Suspense>
  </CountingLoadBoundary>;
}

export function mountFieldCounting(host: HTMLElement, bridge: FieldCountingBridge, onExit?: () => void): FieldCountingMount {
  let root: Root | null = createRoot(host);
  let destroyed = false;
  const render = (nextBridge: FieldCountingBridge, nextOnExit?: () => void) => {
    if (!root || destroyed) return;
    root.render(<RecoverableCountingView bridge={nextBridge} onExit={nextOnExit} />);
  };
  render(bridge, onExit);
  return {
    update(nextBridge, nextOnExit) {
      if (host.isConnected) render(nextBridge, nextOnExit);
      else this.destroy();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root?.unmount();
      root = null;
      host.replaceChildren();
    }
  };
}
