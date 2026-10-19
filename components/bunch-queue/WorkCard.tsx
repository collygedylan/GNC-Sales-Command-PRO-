import { useState } from 'react';
import type { BunchWorkCard } from './contract';
import { actualQuantity, type BunchQueueClient } from '../../services/bunchQueue';
export function WorkCard({ card, client, pending, onSaved }: { card: BunchWorkCard; client: BunchQueueClient; pending: boolean; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState(() => client.draft(card.stablecard_id));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const change = (rowId: string, value: string) => { const next = { ...draft, [rowId]: value }; setDraft(next); client.saveDraft(card.stablecard_id, next); };
  const complete = async () => {
    if (saving || pending) return;
    setError('');
    try {
      const actual_qty_by_row = Object.fromEntries(card.sources.map(source => [source.row_id, actualQuantity(draft[source.row_id] ?? '')]));
      if (!card.sources.length) throw new Error('No source rows are available. Refresh before completing this card.');
      setSaving(true);
      await client.mutate('complete_card', { job_id: card.job_id, card_id: card.card_id, actual_qty_by_row }, card.revision, card.stablecard_id);
      await onSaved();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Your completion could not be saved.'); }
    finally { setSaving(false); }
  };
  return <article className="bq-card" data-bunch-card={card.card_id}>
    <header><h3>{card.variety || card.itemcode} <span>{card.contsize}</span></h3><span className="bq-state">{card.status}</span></header>
    <p className="bq-id">{card.itemcode} · {card.source_location}{card.lot ? ` · Lot ${card.lot}` : ''}</p>
    <p><strong>Drive PTRAVAILABLE:</strong> {card.ptravailable ?? 'Unavailable'}</p>
    <p className="bq-plan"><strong>{card.action}</strong>{card.destination ? ` → ${card.destination}` : ''}</p>
    {card.notes && <p className="bq-notes">Notes: {card.notes}</p>}
    <p className="bq-assignees">Assigned: {card.assignees.map(person => person.display_name || person.username).join(', ') || 'Unassigned'}</p>
    {card.sources.map(source => {
      const sameLocation = card.sources.length === 1 && source.location === card.source_location && source.lot === card.lot;
      const sameAvailable = card.sources.length === 1 && source.ptravailable === card.ptravailable;
      return <div className="bq-source" key={source.row_id}>
      {(!sameLocation || !sameAvailable) && <div className="bq-source-details">
        {!sameLocation && <span>{source.location} · Lot {source.lot || '—'}</span>}
        {!sameAvailable && <small>Drive PTRAVAILABLE: {source.ptravailable ?? 'Unavailable'}</small>}
      </div>}
      {card.can_complete && card.status === 'open' ? <label>Actual Qty Completed
        <input type="text" inputMode="numeric" pattern="[0-9]*" aria-label={`Actual Qty Completed ${source.row_id}`} value={draft[source.row_id] ?? ''} disabled={saving || pending} onChange={event => change(source.row_id, event.target.value)} placeholder="Enter actual count" />
      </label> : source.actual_qty != null && <p>Completed: <strong>{source.actual_qty}</strong></p>}
    </div>;
    })}
    {error && <p role="alert" className="bq-error">{error}</p>}
    {card.can_complete && card.status === 'open' && <button type="button" className="bq-primary text-white" disabled={saving || pending || !card.sources.length} onClick={() => void complete()}>{pending ? 'Completion queued' : saving ? 'Saving…' : 'Complete Work'}</button>}
  </article>;
}
