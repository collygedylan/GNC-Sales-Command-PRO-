import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BunchWorkCard } from './contract';
import { actualQuantity, type BunchQueueClient } from '../../services/bunchQueue';

type BunchQueueShellBridge = {
  openDetail: (options: { title: string; onClose: () => void }) => HTMLElement;
  closeDetail: () => boolean;
};

function getBunchQueueShell(): BunchQueueShellBridge | undefined {
  return (window as Window & { BunchQueueShell?: BunchQueueShellBridge }).BunchQueueShell;
}

export function WorkCard({ card, client, pending, opened, onOpen, onClose, onSaved }: {
  card: BunchWorkCard;
  client: BunchQueueClient;
  pending: boolean;
  opened: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => client.draft(card.stablecard_id));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const [shellMode, setShellMode] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const entryId = useId();
  const change = (rowId: string, value: string) => {
    const next = { ...draft, [rowId]: value };
    setDraft(next);
    client.saveDraft(card.stablecard_id, next);
  };
  const closeDetail = useCallback(() => {
    if (shellMode) getBunchQueueShell()?.closeDetail();
    onClose();
  }, [onClose, shellMode]);

  useEffect(() => {
    if (!opened) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let openedShell = false;
    const shell = getBunchQueueShell();
    if (shell?.openDetail) {
      try {
        const host = shell.openDetail({ title: card.variety || card.itemcode, onClose });
        openedShell = true;
        setError('');
        setShellMode(true);
        setPortalHost(host);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'The Bunch Notes detail view could not open.');
        setShellMode(false);
        setPortalHost(document.body);
      }
    } else {
      setError('');
      setShellMode(false);
      setPortalHost(document.body);
    }
    return () => {
      if (openedShell) shell?.closeDetail();
      else if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
      setPortalHost(null);
    };
  }, [opened, card.variety, card.itemcode, onClose]);

  useEffect(() => {
    if (!opened || shellMode || !portalHost) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeDetail(); }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [opened, shellMode, portalHost, closeDetail]);

  useEffect(() => {
    if (!opened || !portalHost) return;
    const focusTarget = portalHost.querySelector<HTMLElement>('.bq-detail-back');
    focusTarget?.focus({ preventScroll: true });
  }, [opened, portalHost, entryId]);

  const complete = async () => {
    if (saving || pending) return;
    setError('');
    try {
      const actual_qty_by_row = Object.fromEntries(card.sources.map(source => [source.row_id, actualQuantity(draft[source.row_id] ?? '')]));
      if (!card.sources.length) throw new Error('No source rows are available. Refresh before completing this card.');
      setSaving(true);
      await client.mutate('complete_card', { job_id: card.job_id, card_id: card.card_id, actual_qty_by_row }, card.revision, card.stablecard_id);
      closeDetail();
      await onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Your completion could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return <article className="bq-card" data-bunch-card={card.card_id}>
    <button type="button" className="bq-card-summary" aria-expanded={opened} aria-controls={entryId}
      aria-label={`${opened ? 'Close' : 'Open'} Bunch Notes card ${card.variety || card.itemcode}`} onClick={onOpen}>
      <header><h3>{card.variety || card.itemcode} <span>{card.contsize}</span></h3><span className="bq-state">{card.status} <span aria-hidden="true">{opened ? '−' : '+'}</span></span></header>
      <p className="bq-id">{card.itemcode} · {card.source_location}{card.lot ? ` · Lot ${card.lot}` : ''}</p>
      <p><strong>Drive PTRAVAILABLE:</strong> {card.ptravailable ?? 'Unavailable'}</p>
      <p className="bq-plan"><strong>{card.action}</strong>{card.destination ? ` → ${card.destination}` : ''}</p>
      {card.notes && <p className="bq-notes">Notes: {card.notes}</p>}
      <p className="bq-assignees">Assigned: {card.assignees.map(person => person.display_name || person.username).join(', ') || 'Unassigned'}</p>
    </button>
    {opened && portalHost && createPortal(<>
      {shellMode ? <section id={entryId} className="bq-detail-root" role="dialog" aria-modal="false" aria-label={`Bunch Notes detail ${card.variety || card.itemcode}`}>
        <BunchCardEntry card={card} draft={draft} saving={saving} pending={pending} error={error} onChange={change} onDone={() => void complete()} onClose={closeDetail} entryId={entryId} />
      </section> : <div className="bq-fallback-layer">
        <section id={entryId} className="bq-detail-root bq-detail-root--fallback" role="dialog" aria-modal="true" aria-label={`Bunch Notes entry ${card.variety || card.itemcode}`}>
          <button type="button" className="bq-fallback-backdrop" tabIndex={-1} aria-label="Close Bunch Notes detail" onClick={closeDetail} />
          <BunchCardEntry card={card} draft={draft} saving={saving} pending={pending} error={error} onChange={change} onDone={() => void complete()} onClose={closeDetail} entryId={entryId} />
        </section>
      </div>}
    </>, portalHost)}
  </article>;
}

function BunchCardEntry({ card, draft, saving, pending, error, onChange, onDone, onClose, entryId }: {
  card: BunchWorkCard;
  draft: Record<string, string>;
  saving: boolean;
  pending: boolean;
  error: string;
  onChange: (rowId: string, value: string) => void;
  onDone: () => void;
  onClose: () => void;
  entryId: string;
}) {
  return <div className="bq-detail-content">
    <header className="freeze-panel bq-detail-header">
      <button type="button" className="bq-detail-back" onClick={onClose} aria-label="Back to Bunch Notes">← Back</button>
      <div><h1>{card.variety || card.itemcode} <span>{card.contsize}</span></h1><p>{card.itemcode}</p></div>
      <span className="bq-state">{card.status}</span>
    </header>
    <main id={`bq-content-${entryId}`} className="bq-detail-main" aria-labelledby={`${entryId}-heading`}>
      <h2 id={`${entryId}-heading`} className="bq-detail-section-title">Bunch Notes work details</h2>
      <div className="overview-grid bq-detail-overview">
        <div className="overview-card"><div className="overview-label">Source location</div><div className="overview-val">{card.source_location}</div></div>
        <div className="overview-card"><div className="overview-label">Lot</div><div className="overview-val">{card.lot || '—'}</div></div>
        <div className="overview-card"><div className="overview-label">Drive PTRAVAILABLE</div><div className="overview-val">{card.ptravailable ?? 'Unavailable'}</div></div>
        <div className="overview-card"><div className="overview-label">Action</div><div className="overview-val">{card.action}{card.destination ? ` → ${card.destination}` : ''}</div></div>
        <div className="overview-card bq-detail-overview-wide"><div className="overview-label">Assigned</div><div className="overview-val">{card.assignees.map(person => person.display_name || person.username).join(', ') || 'Unassigned'}</div></div>
        {card.notes && <div className="overview-card bq-detail-overview-wide"><div className="overview-label">Notes</div><div className="overview-val">{card.notes}</div></div>}
      </div>
      <section className="bq-detail-fields" aria-label="Completion quantities">
        {card.sources.map(source => {
          const sameLocation = card.sources.length === 1 && source.location === card.source_location && source.lot === card.lot;
          const sameAvailable = card.sources.length === 1 && source.ptravailable === card.ptravailable;
          return <div className="bq-source" key={source.row_id}>
            {(!sameLocation || !sameAvailable) && <div className="bq-source-details">
              {!sameLocation && <span>{source.location} · Lot {source.lot || '—'}</span>}
              {!sameAvailable && <small>Drive PTRAVAILABLE: {source.ptravailable ?? 'Unavailable'}</small>}
            </div>}
            {card.can_complete && card.status === 'open' ? <label className="bq-entry-field">Actual Qty Completed
              <input className="input-field" type="text" inputMode="numeric" pattern="[0-9]*" aria-label={`Actual Qty Completed ${source.row_id}`} value={draft[source.row_id] ?? ''} disabled={saving || pending} onChange={event => onChange(source.row_id, event.target.value)} placeholder="Enter actual count" />
            </label> : source.actual_qty != null && <p>Completed: <strong>{source.actual_qty}</strong></p>}
          </div>;
        })}
      </section>
      {error && <p role="alert" className="bq-error">{error}</p>}
    </main>
    <div id={`bq-actions-${entryId}`} className="req-save-action-wrap bq-detail-actions">
      <button type="button" className="bq-primary text-white" disabled={!card.can_complete || card.status !== 'open' || saving || pending || !card.sources.length} onClick={onDone}>{pending ? 'Completion queued' : saving ? 'Saving…' : 'Done'}</button>
      <button type="button" className="bq-collapse" disabled={saving} onClick={onClose}>Close</button>
    </div>
  </div>;
}
