import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BunchQueueView } from './QueueView';
import type { BunchQueueClient } from '../../services/bunchQueue';
export { createBunchQueueClient } from '../../services/bunchQueue';
class BunchQueueBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="bq-error" role="alert">Bunch Notes could not render. Your saved entries are retained. <button type="button" onClick={() => this.setState({ failed: false })}>Retry</button></div> : this.props.children; }
}
export function mountBunchQueue(host: HTMLElement, client: BunchQueueClient, reviewMode = false) {
  const root = createRoot(host);
  const update = (review: boolean) => root.render(<BunchQueueBoundary><BunchQueueView client={client} reviewMode={review} /></BunchQueueBoundary>);
  update(reviewMode);
  return { update, destroy: () => root.unmount() };
}
