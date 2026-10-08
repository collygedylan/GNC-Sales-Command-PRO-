import { Component, startTransition, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

type BoundaryProps = { label: string; children: ReactNode; onRetry?: () => void };
type BoundaryState = { failed: boolean };

class DeferredErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
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

export function DeferredView({ label, children, onRetry }: BoundaryProps) {
  const [renderContent, setRenderContent] = useState(false);
  useEffect(() => {
    // Reveal the lazy route as a transition from the already mounted loading row.
    // This avoids a new Suspense fallback's minimum display delay, while the old
    // route still unmounts immediately (including Drive's request cleanup).
    startTransition(() => setRenderContent(true));
  }, []);
  const loading = <DeferredViewFallback label={label} />;
  return (
    <DeferredErrorBoundary label={label} onRetry={onRetry}>
      <Suspense fallback={loading}>
        {renderContent ? children : loading}
      </Suspense>
    </DeferredErrorBoundary>
  );
}
