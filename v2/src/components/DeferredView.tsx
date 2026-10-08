import { Component, Suspense, type ReactNode } from 'react';
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
  return (
    <DeferredErrorBoundary label={label} onRetry={onRetry}>
      <Suspense fallback={<DeferredViewFallback label={label} />}>
        {children}
      </Suspense>
    </DeferredErrorBoundary>
  );
}
