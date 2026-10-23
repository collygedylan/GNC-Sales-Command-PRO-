import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { BunchQueueClient } from '../../services/bunchQueue';
import { WorkCard } from './WorkCard';
import { ReviewCard } from './ReviewCard';
export function BunchQueueView({ client, reviewMode = false }: { client: BunchQueueClient; reviewMode?: boolean }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [openedCardId, setOpenedCardId] = useState<string | null>(null);
  const refresh = () => client.load(state.filter, state.offset, reviewMode);
  const openCard = useCallback((stablecardId: string) => setOpenedCardId(stablecardId), []);
  const closeCard = useCallback(() => setOpenedCardId(null), []);
  useEffect(() => {
    const initial = client.getSnapshot();
    void client.load(initial.offline && initial.loadedFilter === 'mine' ? 'mine' : 'all', 0, reviewMode);
  }, [client, reviewMode]);
  useEffect(() => {
    const reconnect = () => { void client.flush().then(() => client.load(client.getSnapshot().filter, client.getSnapshot().offset, reviewMode)); };
    window.addEventListener('online', reconnect);
    const update = () => { void client.load(client.getSnapshot().filter, client.getSnapshot().offset, reviewMode); };
    window.addEventListener('gnc:bunch-published', update);
    return () => { window.removeEventListener('online', reconnect); window.removeEventListener('gnc:bunch-published', update); };
  }, [client, reviewMode]);
  const pageCards = state.page?.cards ?? [];
  const completeAuthorizedSnapshot = state.loadedFilter === 'all' && state.offset === 0 && !!state.page && state.page.total <= pageCards.length;
  const partialMineSnapshot = !reviewMode && state.filter === 'all' && state.loadedFilter === 'mine';
  const pageMatchesFilter = state.loadedFilter === state.filter || partialMineSnapshot
    || (completeAuthorizedSnapshot && (state.filter === 'unassigned' || state.filter.startsWith('assignee:')));
  const cards = pageMatchesFilter ? pageCards : [];
  const visibleCards = completeAuthorizedSnapshot && !reviewMode
    ? state.filter === 'unassigned' ? cards.filter(card => card.status === 'open' && card.assignees.length === 0)
      : state.filter.startsWith('assignee:') ? cards.filter(card => card.status === 'open' && card.assignees.some(person => person.id === state.filter.slice('assignee:'.length)))
        : cards
    : cards;
  useEffect(() => {
    if (!openedCardId || visibleCards.some(card => card.stablecard_id === openedCardId)) return;
    const shell = (window as Window & { BunchQueueShell?: { closeDetail: () => boolean } }).BunchQueueShell;
    shell?.closeDetail();
    setOpenedCardId(null);
  }, [openedCardId, visibleCards]);
  const rows = reviewMode ? state.reviews?.reviews : visibleCards;
  const total = reviewMode ? state.reviews?.total ?? 0 : completeAuthorizedSnapshot ? visibleCards.length : pageMatchesFilter ? state.page?.total ?? 0 : 0;
  return <section className="bq-root" aria-label={reviewMode ? 'Count Review' : 'Bunch Notes work queue'}>
    <div className="bq-toolbar"><h2>{reviewMode ? 'Count Review' : 'Bunch Notes'}</h2>
      {!reviewMode && <label>Show<select aria-label="Bunch Notes filter" value={state.filter} onChange={event => { client.setFilter(event.target.value as typeof state.filter); }}>
        <option value="all">All authorized work</option>
        <option value="mine">My assigned work</option>
        {state.page?.assignee_options.map(person => <option key={person.id} value={`assignee:${person.id}`}>Assigned: {person.username} ({person.count})</option>)}
        {!!state.page?.unassigned_count && <option value="unassigned">Unassigned ({state.page.unassigned_count})</option>}
        <option value="completed">Completed work</option>
      </select></label>}
      <button type="button" disabled={state.loading} onClick={() => { void client.flush().then(refresh); }}>{state.loading ? 'Refreshing…' : 'Refresh'}</button>
    </div>
    {state.offline && <p className="bq-notice" role="status">{state.loadedFilter === 'mine' ? 'Offline · Showing the saved assigned-work snapshot only. All authorized work will refresh when you reconnect.' : 'Offline · Showing saved work. Your entries are retained until completion is confirmed.'}</p>}
    {!state.offline && partialMineSnapshot && <p className="bq-notice" role="status">Showing saved assigned work only until the full authorized queue refreshes.</p>}
    {state.pending.length > 0 && <p className="bq-notice" role="status">{state.pending.length} saved update(s) awaiting confirmation. <button type="button" onClick={() => { void client.flush().then(refresh); }}>Retry saved updates</button></p>}
    {state.error && <p className="bq-error" role="alert">{state.error}</p>}
    {state.message && <p className="bq-success" role="status">{state.message}</p>}
    {!rows?.length && <p className="bq-empty">{reviewMode ? 'No recount reviews in your assigned scope.' : state.filter.startsWith('assignee:') ? 'No Bunch Notes assigned to this user.' : state.filter === 'unassigned' ? 'No unassigned Bunch Notes.' : 'No Bunch Notes in this filter.'}</p>}
    <div className="bq-grid">{reviewMode ? state.reviews?.reviews.map(review => <ReviewCard key={review.id} review={review} client={client} counters={state.reviews?.counters ?? []} pending={state.pending.some(command => command.target === `review:${review.id}`)} onSaved={refresh} />) : visibleCards.map(card => <WorkCard key={card.stablecard_id} card={card} client={client} pending={state.pending.some(command => command.target === card.stablecard_id)} opened={openedCardId === card.stablecard_id} onOpen={() => openCard(card.stablecard_id)} onClose={closeCard} onSaved={refresh} />)}</div>
    {total > 100 && <nav className="bq-pagination" aria-label="Bunch Notes pages"><button type="button" disabled={state.offset === 0 || state.loading} onClick={() => { void client.load(state.filter, Math.max(0, state.offset - 100), reviewMode); }}>Previous</button><span>{state.offset + 1}–{Math.min(state.offset + 100, total)} of {total}</span><button type="button" disabled={state.offset + 100 >= total || state.loading} onClick={() => { void client.load(state.filter, state.offset + 100, reviewMode); }}>Next</button></nav>}
  </section>;
}
