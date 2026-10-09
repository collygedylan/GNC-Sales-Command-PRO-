import { Component, startTransition, Suspense, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

type BoundaryProps = { label: string; children: ReactNode; onRetry?: () => void; onLoadError?: () => void; loaded?: boolean; onContentReady?: () => void };
type BoundaryState = { failed: boolean };

class DeferredErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onLoadError?.();
  }

  render() {
    if (this.state.failed) {
      return (
        <section className="empty-state deferred-view-error" role="alert">
          <span>{this.props.label} could not be loaded.</span>
          <button type="button" onClick={this.props.onRetry ?? (() => window.location.reload())}>Reload app to retry</button>
        </section>
      );
    }
    return this.props.children;
  }
}

function DeferredViewFallback({ label }: { label: string }) {
  return <div className="empty-state deferred-view-loading" role="status"><Loader2 className="spin" /> Loading {label}…</div>;
}

function DeferredContentCommit({ children, onContentReady }: Pick<BoundaryProps, 'children' | 'onContentReady'>) {
  useEffect(() => { onContentReady?.(); }, [onContentReady]);
  return children;
}

export function DeferredView({ label, children, onRetry, onLoadError, loaded = false, onContentReady }: BoundaryProps) {
  const [renderContent, setRenderContent] = useState(() => loaded);
  useLayoutEffect(() => {
    if (loaded) return;
    // Preserve the cold-chunk transition so Suspense keeps the compact loading
    // row rather than introducing its fallback delay during route entry.
    startTransition(() => setRenderContent(true));
  }, [loaded]);
  const loading = <DeferredViewFallback label={label} />;
  return (
    <DeferredErrorBoundary label={label} onRetry={onRetry} onLoadError={onLoadError}>
      <Suspense fallback={loading}>
        {renderContent ? <DeferredContentCommit onContentReady={onContentReady}>{children}</DeferredContentCommit> : loading}
      </Suspense>
    </DeferredErrorBoundary>
  );
}
