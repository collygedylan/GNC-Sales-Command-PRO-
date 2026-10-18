import { useState } from 'react';
import type { BunchPerson, BunchReview } from './contract';
import { actualQuantity, type BunchQueueClient } from '../../services/bunchQueue';
export function ReviewCard({ review, counters, client, pending, onSaved }: { review: BunchReview; counters: BunchPerson[]; client: BunchQueueClient; pending: boolean; onSaved: () => Promise<void> }) {
  const target = `review:${review.id}`, saved = client.draft(target);
  const customCounterValue = '__custom_username__';
  const [counter, setCounter] = useState(saved.counter || review.assigned_counter_id || (review.assigned_counter_username ? customCounterValue : ''));
  const [customUsername, setCustomUsername] = useState(saved.counter_username || review.assigned_counter_username || '');
  const [quantities, setQuantities] = useState(saved);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (assign: boolean) => {
    if (saving || pending) return;
    try {
      setError('');
      if (assign && !counter) throw new Error('Choose a member of the Count Team.');
      if (assign && counter === customCounterValue && !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(customUsername.trim())) {
        throw new Error('Use 1–64 characters: letters, numbers, periods, underscores, or hyphens.');
      }
      const payload = assign
        ? { review_id: review.id, ...(counter === customCounterValue ? { counter_username: customUsername.trim().toLocaleLowerCase() } : { counter_id: counter }), expected_revision: review.revision }
        : { review_id: review.id, recount_qty_by_row: Object.fromEntries(review.sources.map(source => [source.row_id, actualQuantity(quantities[source.row_id] || '')])), expected_revision: review.revision };
      setSaving(true);
      await client.mutate(assign ? 'assign_counter' : 'complete_recount', payload, review.revision, target);
      await onSaved();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '';
      setError(message === 'BUNCH_NOTE_COUNTER_INVALID' ? 'That username cannot be assigned. Choose an active, eligible Count Team member.' : message || 'The recount update could not be saved.');
    }
    finally { setSaving(false); }
  };
  const orderedCounters = counters.map((person, index) => ({ person, index })).sort((left, right) => {
    const rank = (person: BunchPerson) => {
      const username = person.username.trim().toLocaleLowerCase();
      if (username === 'sharon_combs') return 0;
      if (username === 'dylan_collyge') return 1;
      return 2;
    };
    return rank(left.person) - rank(right.person) || left.index - right.index;
  }).map(item => item.person);
  const assignedCounterLabel = review.assigned_counter_username
    || counters.find(person => person.id === review.assigned_counter_id)?.display_name
    || counters.find(person => person.id === review.assigned_counter_id)?.username;
  return <article className="bq-card bq-review" data-bunch-review={review.id}>
    <header><h3>{review.variety} <span>{review.contsize}</span></h3><span className="bq-state">{review.status === 'resolved' ? 'Recount complete' : 'NEEDS RECOUNT REVIEW'}</span></header>
    <p className="bq-id">{review.itemcode} · {review.source_location}{review.destination ? ` → ${review.destination}` : ''}</p>
    <p>Completed by: <strong>{review.completed_by}</strong></p>
    <p>Reported Action Qty: <strong>{review.actual_qty}</strong> · Drive PTRAVAILABLE: <strong>{review.ptravailable ?? 'Unavailable'}</strong></p>
    <p className="bq-variance">Discrepancy: <strong>{review.variance == null ? 'Needs source review' : review.variance > 0 ? `+${review.variance}` : review.variance}</strong></p>
    {assignedCounterLabel && <p>Assigned counter: <strong>{assignedCounterLabel}</strong></p>}
    {review.can_assign && <div className="bq-review-actions"><label>Assign Recount To<select aria-label={`Assign Recount To ${review.id}`} value={counter} disabled={saving || pending} onChange={event => { const value = event.target.value; setCounter(value); client.saveDraft(target, { ...quantities, counter: value, counter_username: value === customCounterValue ? customUsername : '' }); }}><option value="">Choose counter</option>{orderedCounters.map(person => <option key={person.id} value={person.id}>{person.display_name || person.username}</option>)}<option value={customCounterValue}>Custom username…</option></select></label>{counter === customCounterValue && <><label>Custom Count Team username<input aria-label={`Custom Count Team username ${review.id}`} autoComplete="off" maxLength={64} value={customUsername} disabled={saving || pending} onChange={event => { const value = event.target.value; setCustomUsername(value); client.saveDraft(target, { ...quantities, counter, counter_username: value }); }} /></label><p className="bq-muted">An unmatched name is saved as a tag; it does not create an account.</p></>}<button type="button" className="bq-primary text-white" disabled={!counter || (counter === customCounterValue && !customUsername.trim()) || saving || pending} onClick={() => void submit(true)}>Assign Counter</button></div>}
    {review.can_complete && <div className="bq-review-actions"><>{review.sources.map(source => <label key={source.row_id}>Recount Qty · {source.location} · Lot {source.lot || '—'}<input inputMode="numeric" aria-label={`Recount Qty ${source.row_id}`} value={quantities[source.row_id] || ''} disabled={saving || pending} onChange={event => { const next = { ...quantities, [source.row_id]: event.target.value }; setQuantities(next); client.saveDraft(target, { ...next, counter, counter_username: customUsername }); }} /></label>)}</><button type="button" className="bq-primary text-white" disabled={saving || pending} onClick={() => void submit(false)}>Complete Recount</button></div>}
    {review.recount_qty != null && <p>Recount result: <strong>{review.recount_qty}</strong></p>}
    {pending && <p role="status">Recount update queued on this device.</p>}
    {error && <p role="alert" className="bq-error">{error}</p>}
  </article>;
}
