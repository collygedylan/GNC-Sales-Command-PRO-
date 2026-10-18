import { useEffect, useSyncExternalStore } from 'react';
import type { BunchQueueClient } from '../../services/bunchQueue';
import { WorkCard } from './WorkCard';
import { ReviewCard } from './ReviewCard';
export function BunchQueueView({ client, reviewMode = false }: { client: BunchQueueClient; reviewMode?: boolean }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const refresh = () => client.load(state.filter, state.offset, reviewMode);
  useEffect(() => { void client.load('mine', 0, reviewMode); }, [client, reviewMode]);
  useEffect(() => {
    const reconnect = () => { void client.flush().then(() => client.load(client.getSnapshot().filter, client.getSnapshot().offset, reviewMode)); };
    window.addEventListener('online', reconnect);
    const update = () => { void client.load(client.getSnapshot().filter, client.getSnapshot().offset, reviewMode); };
    window.addEventListener('gnc:bunch-published', update);
    return () => { window.removeEventListener('online', reconnect); window.removeEventListener('gnc:bunch-published', update); };
  }, [client, reviewMode]);
  const rows = reviewMode ? state.reviews?.reviews : state.page?.cards;
  const total = reviewMode ? state.reviews?.total ?? 0 : state.page?.total ?? 0;
  return <section className="bq-root" aria-label={reviewMode ? 'Count Review' : 'Bunch Notes work queue'}>
    <div className="bq-toolbar"><h2>{reviewMode ? 'Count Review' : 'Bunch Notes'}</h2>
      {!reviewMode && <label>Show<select aria-label="Bunch Notes filter" value={state.filter} onChange={event => { void client.load(event.target.value as 'mine' | 'all' | 'completed', 0); }}><option value="mine">My assigned work</option><option value="all">All authorized work</option><option value="completed">Completed work</option></select></label>}
      <button type="button" disabled={state.loading} onClick={() => { void client.flush().then(refresh); }}>{state.loading ? 'Refreshing…' : 'Refresh'}</button>
    </div>
    {state.offline && <p className="bq-notice" role="status">Offline · Showing saved work. Your entries are retained until completion is confirmed.</p>}
    {state.pending.length > 0 && <p className="bq-notice" role="status">{state.pending.length} saved update(s) awaiting confirmation. <button type="button" onClick={() => { void client.flush().then(refresh); }}>Retry saved updates</button></p>}
    {state.error && <p className="bq-error" role="alert">{state.error}</p>}
    {state.message && <p className="bq-success" role="status">{state.message}</p>}
    {!rows?.length && <p className="bq-empty">{state.loading ? 'Loading assigned work…' : reviewMode ? 'No recount reviews in your assigned scope.' : 'No Bunch Notes in this filter.'}</p>}
    <div className="bq-grid">{reviewMode ? state.reviews?.reviews.map(review => <ReviewCard key={review.id} review={review} client={client} counters={state.reviews?.counters ?? []} pending={state.pending.some(command => command.target === `review:${review.id}`)} onSaved={refresh} />) : state.page?.cards.map(card => <WorkCard key={card.stablecard_id} card={card} client={client} pending={state.pending.some(command => command.target === card.stablecard_id)} onSaved={refresh} />)}</div>
    {total > 100 && <nav className="bq-pagination" aria-label="Bunch Notes pages"><button type="button" disabled={state.offset === 0 || state.loading} onClick={() => { void client.load(state.filter, Math.max(0, state.offset - 100), reviewMode); }}>Previous</button><span>{state.offset + 1}–{Math.min(state.offset + 100, total)} of {total}</span><button type="button" disabled={state.offset + 100 >= total || state.loading} onClick={() => { void client.load(state.filter, state.offset + 100, reviewMode); }}>Next</button></nav>}
  </section>;
}
