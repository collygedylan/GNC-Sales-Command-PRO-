import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { buildLocationCardBoard } from './card-model.mjs';

const valueOf = (object, ...keys) => {
  for (const key of keys) if (object?.[key] !== undefined && object?.[key] !== null) return object[key];
  return '';
};
const quantityOf = (object, ...keys) => {
  for (const key of keys) {
    const raw = object?.[key];
    if (raw === null || raw === undefined || String(raw).trim() === '') continue;
    const number = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '').trim());
    if (Number.isFinite(number)) return number;
  }
  return 'Unknown';
};
const labelUser = user => user.full_name || user.display || user.display_name || user.username || user.id;
const DIRECTIONS = ['West to East', 'East to West', 'North to South', 'South to North', 'Custom'];
const EMPTY_VIEW_STATE = Object.freeze({});
function newCardId() {
  if (!globalThis.crypto?.randomUUID) throw new Error('Secure random IDs are unavailable in this browser.');
  return globalThis.crypto.randomUUID();
}
const stockDescription = total => total.complete ? String(total.value)
  : `Known subtotal ${total.value} (${total.knownCount}/${total.rowCount} lots)`;

function CardEditor({ location, card, users, busy, viewState, onViewState, onCardChange, onMove, onSave, onLocationInstructions }) {
  const stateId = card.view_key || card.id;
  const initial = useMemo(() => ({ ...card }), [card.id]);
  const viewStateRef = useRef(viewState);
  viewStateRef.current = viewState;
  const commitViewState = patch => {
    const next = { ...viewStateRef.current, ...patch };
    viewStateRef.current = next; onViewState?.(next);
  };
  const reportError = (cause, fallback, blocksSave = true) => {
    const message = cause?.message || fallback;
    setError(message); setChangeRejected(blocksSave);
    commitViewState({ cardErrors: { ...viewStateRef.current.cardErrors, [stateId]: message },
      rejectedCardIds: blocksSave ? [...new Set([...(viewStateRef.current.rejectedCardIds || []), stateId])] : (viewStateRef.current.rejectedCardIds || []).filter(id => id !== stateId) });
  };
  const [form, setForm] = useState(() => viewState.cardForms?.[stateId] || initial);
  const [dirty, setDirty] = useState(() => viewState.dirtyCardIds?.includes(stateId) || false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(() => viewState.cardErrors?.[stateId] || '');
  const [changeRejected, setChangeRejected] = useState(() => viewState.rejectedCardIds?.includes(stateId) || false);
  const [customDirection, setCustomDirection] = useState(Boolean(card.direction && !DIRECTIONS.includes(card.direction)));
  const [customHouse, setCustomHouse] = useState(Boolean(card.house && !(location.house_sections || []).some(section => section.name === card.house)));
  const incomingSignature = JSON.stringify(card);
  const [signature, setSignature] = useState(incomingSignature);
  useEffect(() => {
    if (!viewState.dirtyCardIds?.includes(stateId) && dirty) setDirty(false);
    if (!dirty && incomingSignature !== signature) {
      setForm({ ...card }); setSignature(incomingSignature);
      setCustomDirection(Boolean(card.direction && !DIRECTIONS.includes(card.direction)));
      setCustomHouse(Boolean(card.house && !(location.house_sections || []).some(section => section.name === card.house)));
    }
  }, [incomingSignature, signature, dirty, card, viewState.dirtyCardIds, stateId]);

  const update = patch => {
    const next = { ...form, ...patch, included: true,
      id: form.included || (form.id && form.id !== card.id) ? form.id : newCardId(),
      kind: form.kind || 'inventory', row_ids: card.row_ids,
      house: patch.house ?? (form.included ? form.house : location.target_houses || ''),
      direction: patch.direction ?? (form.included ? form.direction : location.direction || ''),
      target_houses: patch.target_houses ?? (form.included ? form.target_houses : location.target_houses || '') };
    setForm(next); setDirty(true); setError(''); setChangeRejected(false);
    commitViewState({ cardForms: { ...viewStateRef.current.cardForms, [stateId]: next },
      dirtyCardIds: [...new Set([...(viewStateRef.current.dirtyCardIds || []), stateId])],
      cardErrors: { ...viewStateRef.current.cardErrors, [stateId]: '' },
      rejectedCardIds: (viewStateRef.current.rejectedCardIds || []).filter(id => id !== stateId) });
    try {
      const result = onCardChange?.(location, { ...card, ...next });
      if (result && typeof result.catch === 'function') result.catch(cause => reportError(cause, 'Could not apply this card edit. Your changes are still here.'));
    } catch (cause) { reportError(cause, 'Could not apply this card edit. Your changes are still here.'); }
    return next;
  };
  const stop = event => event.stopPropagation();
  const save = async event => {
    stop(event); if (!onSave || saving || busy || changeRejected) return;
    setSaving(true); setError('');
    try {
      const saved = await onSave(location, { ...form });
      const confirmed = saved && typeof saved === 'object' ? { ...form, ...saved } : form;
      setForm(confirmed); setDirty(false); setSignature(JSON.stringify(confirmed));
      commitViewState({ cardForms: { ...viewStateRef.current.cardForms, [stateId]: confirmed },
        dirtyCardIds: [], cardErrors: {}, rejectedCardIds: [] });
    } catch (cause) {
      const message = cause?.message || 'Could not save this card. Your edits are still here.';
      setError(message); commitViewState({ cardErrors: { ...viewStateRef.current.cardErrors, [stateId]: message } });
    } finally { setSaving(false); }
  };
  const workerOptions = [...users];
  const currentLocation = valueOf(location, 'location_code', 'location');
  const activeAction = viewState.activeQuickActions?.[stateId] || '';
  const openAction = action => commitViewState({ activeQuickActions: {
    ...viewStateRef.current.activeQuickActions, [stateId]: activeAction === action ? '' : action } });
  const setIncluded = event => {
    stop(event); const included = event.target.checked;
    const next = { ...form, included, kind: form.kind || 'inventory',
      id: included ? (form.included || (form.id && form.id !== card.id) ? form.id : newCardId()) : form.id,
      row_ids: card.row_ids, owner_id: form.owner_id ?? null,
      house: form.house ?? location.target_houses ?? '', direction: form.direction ?? location.direction ?? '',
      target_houses: form.target_houses ?? location.target_houses ?? '' };
    setCustomHouse(Boolean(next.house && !(location.house_sections || []).some(section => section.name === next.house)));
    setForm(next); setDirty(true); setError(''); setChangeRejected(false);
    commitViewState({ cardForms: { ...viewStateRef.current.cardForms, [stateId]: next },
      dirtyCardIds: [...new Set([...(viewStateRef.current.dirtyCardIds || []), stateId])],
      cardErrors: { ...viewStateRef.current.cardErrors, [stateId]: '' },
      rejectedCardIds: (viewStateRef.current.rejectedCardIds || []).filter(id => id !== stateId) });
    try {
      const result = onCardChange?.(location, next);
      if (result && typeof result.catch === 'function') result.catch(cause => reportError(cause, 'Could not update card inclusion.'));
    } catch (cause) { reportError(cause, 'Could not update card inclusion.'); }
  };
  const move = event => {
    stop(event);
    const targetCard = form.included ? { ...card, ...form } : update({});
    try {
      const result = onMove?.(location, targetCard);
      if (result && typeof result.catch === 'function') result.catch(cause => reportError(cause, 'Could not open the Move action.', false));
    } catch (cause) { reportError(cause, 'Could not open the Move action.', false); }
  };
  const expanded = (viewState.expandedCardIds || []).includes(stateId);
  const toggleLots = () => commitViewState({ expandedCardIds: expanded
    ? (viewStateRef.current.expandedCardIds || []).filter(id => id !== stateId)
    : [...new Set([...(viewStateRef.current.expandedCardIds || []), stateId])] });
  const hasControls = target => target.closest('button,input,select,textarea,label,summary,a');
  return <article className="bn-board-card" data-card-id={card.id} tabIndex={0} aria-expanded={expanded}
    onClick={event => { if (!hasControls(event.target)) toggleLots(); }}
    onKeyDown={event => { if (!hasControls(event.target) && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggleLots(); } }}>
    <fieldset className="bn-board-card__fieldset" disabled={busy || saving}>
    <div className="bn-board-card__top">
      <div><span className="bn-board-card__kind">{card.kind === 'shared' ? 'Shared task' : (form.included ? 'Included inventory' : 'Available inventory')}</span>
        <strong>{card.item_desc || card.commonname || card.action?.label || 'Operational task'}</strong>
        <span>{[card.item_size || card.contsize, card.quantity_constraint].filter(Boolean).join(' · ')}</span>
        <label className="bn-board-card__include"><input type="checkbox" checked={Boolean(form.included)} onClick={stop} onChange={setIncluded} /> Include in this Bunch Note</label>
        <span className="bn-board-card__metadata">Worker: {users.find(user => user.id === form.owner_id)?.display || users.find(user => user.id === form.owner_id)?.full_name || users.find(user => user.id === form.owner_id)?.username || (form.owner_id ? 'Assigned' : 'Unassigned')}</span>
        <span className="bn-board-card__metadata">House: {form.house || 'Not specified'} · Direction: {form.direction || (!form.included ? location.direction : '') || 'Not specified'}</span>
      </div>
      <div className="bn-board-card__quick" aria-label="Card quick actions">
        <button type="button" onClick={move}>Move</button>
        <button type="button" aria-label="Assign Worker Name" aria-expanded={activeAction === 'worker'} onClick={event => { stop(event); openAction('worker'); }}>Assign</button>
        <button type="button" aria-label="House to work in" aria-expanded={activeAction === 'house'} onClick={event => { stop(event); openAction('house'); }}>House</button>
        <button type="button" aria-expanded={activeAction === 'direction'} onClick={event => { stop(event); openAction('direction'); }}>Direction</button>
        {activeAction === 'worker' && <label>Worker<select aria-label="Assign worker" value={form.owner_id || ''} disabled={Boolean(location.job_id)} onClick={stop} onChange={event => update({ owner_id: event.target.value || null })}>
          <option value="">Unassigned</option>{workerOptions.map(user => <option key={user.id} value={user.id}>{labelUser(user)}</option>)}
        </select>{location.job_id && <small>Reassign published work in Que.</small>}</label>}
        {activeAction === 'house' && <label>House<select aria-label="House to work in" value={customHouse ? 'Custom' : (form.house || '')} onClick={stop} onChange={event => {
          const custom = event.target.value === 'Custom'; setCustomHouse(custom);
          if (!custom) update({ house: event.target.value });
        }}>
          <option value="">Select house</option>{(location.house_sections || []).map(section => <option key={section.id} value={section.name}>{section.name}</option>)}<option value="Custom">Custom house…</option>
        </select></label>}
        {activeAction === 'direction' && <label>Direction<select aria-label="Direction" value={customDirection ? 'Custom' : (form.direction || (!form.included ? location.direction : '') || '')} onClick={stop} onChange={event => {
          setCustomDirection(event.target.value === 'Custom');
          update({ direction: event.target.value === 'Custom' ? form.direction : event.target.value });
        }}><option value="">{form.included ? 'Not specified' : 'Use location default'}</option>{DIRECTIONS.map(direction => <option key={direction} value={direction}>{direction}</option>)}</select></label>}
        {activeAction === 'direction' && customDirection && <input aria-label="Custom direction" value={form.direction || ''} onClick={stop} onChange={event => update({ direction: event.target.value })} />}
        {activeAction === 'house' && customHouse && <input aria-label="Custom house to work in" value={form.house || ''} onClick={stop} onChange={event => update({ house: event.target.value })} />}
      </div>
    </div>
    <div className="bn-board-card__totals">
      {card.kind !== 'shared' && <>
        <span><b>Location Total (On Hand)</b>{stockDescription(card.on_hand)}{!card.on_hand.complete && <em> · incomplete</em>}</span>
        <span><b>Available</b>{stockDescription(card.available)}{!card.available.complete && <em> · incomplete</em>}</span>
      </>}
      <span>{card.row_ids.length} lot{card.row_ids.length === 1 ? '' : 's'}{!card.row_coverage_complete && <em> · source rows unavailable</em>}</span>
    </div>
    <div className="bn-board-card__actions">
      <button type="button" onClick={event => { stop(event); onLocationInstructions?.(location); }}>Location instructions</button>
      <button type="button" disabled={busy || saving || !dirty || !onSave || changeRejected} onClick={save}>{saving ? 'Saving…' : 'Save card'}</button>
      <span aria-live="polite">{dirty ? 'Unsaved changes' : form.included ? 'Included in draft' : 'Not included'}</span>
    </div>
    </fieldset>
    {error && <p className="bn-board-card__error" role="alert">{error}</p>}
    {!card.row_coverage_complete && <p className="bn-board-card__error" role="status">Saved selection needs review. Source lot membership changed. Refresh source to review added matching lots; missing or changed lots remain in the saved selection until resolved. Totals are incomplete.</p>}
    <details className="bn-board-lots" open={expanded} onToggle={event => {
      const ids = new Set(viewStateRef.current.expandedCardIds || []);
      event.currentTarget.open ? ids.add(stateId) : ids.delete(stateId);
      commitViewState({ expandedCardIds: [...ids] });
    }} onClick={stop}><summary>Expand all lot details ({card.rows.length})</summary>
      <div>{card.rows.map(row => <dl key={valueOf(row, 'unique_id', 'UNIQUE_ID', 'id')}>
        <dt>Lot</dt><dd>{valueOf(row, 'lotcode', 'LOTCODE', 'lot_code') || '—'}</dd>
        <dt>Item code</dt><dd>{valueOf(row, 'itemcode', 'ITEMCODE') || card.itemcode || '—'}</dd>
        <dt>Location</dt><dd>{valueOf(row, 'location_code', 'LOCATIONCODE', 'locationcode') || currentLocation}</dd>
        <dt>Sales year</dt><dd>{valueOf(row, 'salesyear', 'SALESYEAR') || '—'}</dd>
        <dt>Size</dt><dd>{valueOf(row, 'contsize', 'CONTSIZE', 'ITEMSPEC', 'SIZE') || '—'}</dd>
        <dt>Season</dt><dd>{valueOf(row, 'season', 'SEASON') || '—'}</dd>
        <dt>On Hand</dt><dd>{quantityOf(row, 'stock', 'STOCK', 'PTRONHAND', 'ptronhand', 'onhand', 'ONHAND')}</dd>
        <dt>Available</dt><dd>{quantityOf(row, 'available', 'AVAILABLE', 'PTRAVAILABLE', 'ptravailable')}</dd>
        <dt>Flags</dt><dd>{valueOf(row, 'flags', 'FLAGS') || '—'}</dd>
        <dt>Hold</dt><dd>{valueOf(row, 'hold', 'HOLD', 'holdstopcode', 'HOLDSTOPCODE') || '—'}</dd>
        <dt>Warehouse</dt><dd>{valueOf(row, 'warehouse', 'WAREHOUSE') || '—'}</dd>
        <dt>Notes</dt><dd>{valueOf(row, 'location_notes', 'LOCATION_NOTES', 'notes') || '—'}</dd>
        <dt>Source UID</dt><dd>{valueOf(row, 'unique_id', 'UNIQUE_ID') || '—'}</dd>
      </dl>)}</div>
    </details>
  </article>;
}

export function BunchNoteCardBoard({ rows = [], locations = [], users = [], busy = false,
  viewState = EMPTY_VIEW_STATE, onViewState, onCardChange, onMove, onLocationInstructions, onSave }) {
  const [localViewState, setLocalViewState] = useState(viewState);
  const lastExternalViewState = useRef(viewState);
  useEffect(() => {
    if (viewState !== lastExternalViewState.current) {
      lastExternalViewState.current = viewState;
      setLocalViewState(viewState);
    }
  }, [viewState]);
  const changeViewState = next => { setLocalViewState(next); onViewState?.(next); };
  const board = useMemo(() => buildLocationCardBoard(locations, rows), [locations, rows]);
  return <div className="bn-card-board" aria-label="Bunch Note inventory cards">
    {board.map(({ location, cards, groups }) => {
      const locationCode = valueOf(location, 'location_code', 'location') || 'Location';
      return <section className="bn-card-board__location" key={location.id || locationCode}>
        <header><h3>{locationCode}</h3><p>{location.direction || 'Direction not set'}{location.target_houses ? ` · ${location.target_houses}` : ''}</p>
          {location.general_instructions && <p>{location.general_instructions}</p>}</header>
        {groups.map(group => <section className="bn-card-board__group" key={group.key}>
          <header><span>{group.orphan ? 'Saved card · review source' : group.location_code}</span><h4>{group.commonname || group.itemcode || 'Inventory'}</h4>
            <p>{group.itemcode && `${group.itemcode} · `}{group.contsize || 'Size not specified'}</p>
            <div className="bn-card-board__summary">
              <span><b>Location Total (On Hand)</b>{stockDescription(group.on_hand)}{!group.on_hand.complete && <em> · incomplete</em>}</span>
              <span><b>Available</b>{stockDescription(group.available)}{!group.available.complete && <em> · incomplete</em>}</span>
              <span>{group.row_ids.length} distinct lot{group.row_ids.length === 1 ? '' : 's'}</span>
            </div>
          </header>
          <div>{group.cards.map(card => <CardEditor key={card.view_key || card.id} {...{ location, card, users, busy, viewState: localViewState, onViewState: changeViewState, onCardChange, onMove, onSave, onLocationInstructions }} />)}</div>
        </section>)}
        {!cards.length && <p className="bn-card-board__empty">No cards included in this Bunch Note yet.</p>}
      </section>;
    })}
  </div>;
}

export function mountBunchNoteCards(host, props) {
  const root = createRoot(host);
  const update = next => root.render(<BunchNoteCardBoard {...next} />);
  update(props);
  return { update, destroy: () => root.unmount() };
}
