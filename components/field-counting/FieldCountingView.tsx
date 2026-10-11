import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import useSWR, { SWRConfig, type Cache, type State } from 'swr';
import type {
  CountRow,
  CountingLotRow,
  CountingType,
  FieldCountingBridge,
  FieldCountingMutation,
  FieldCountingMutationEntry,
  FieldCountingQuery,
  FieldCountingSnapshot
} from './contract';
import { countInputKey, parseWholeCount, stableCommandId, type CountInputState } from './model';

const PAGE_SIZE = 100;
const DIRECTIONS = [
  { key: 'north_south', label: 'North → South' },
  { key: 'south_north', label: 'South → North' },
  { key: 'east_west', label: 'East → West' },
  { key: 'west_east', label: 'West → East' }
] as const;
const NORTH_SOUTH_BLOCKS = new Set(['A', 'B', 'C', 'D', 'L']);
const NORTH_SOUTH_LOCATIONS = new Set(['20.E', '21.E', '22.E', '23.E']);

type Scope = { block: string; location: string };
type SubmitMode = 'save' | 'complete';

function allowedDirections(scope: Scope) {
  const block = scope.block.trim().toUpperCase();
  const location = scope.location.trim().toUpperCase();
  const northSouth = NORTH_SOUTH_BLOCKS.has(block) || NORTH_SOUTH_LOCATIONS.has(location);
  const allowed = northSouth ? new Set(['north_south', 'south_north']) : new Set(['east_west', 'west_east']);
  return DIRECTIONS.filter(direction => allowed.has(direction.key));
}

function countByUid(rows: CountRow[]) {
  return new Map(rows.map(row => [row.sourceUid, row]));
}

function mergeOptions<T extends { value: string }>(previous: T[], incoming: T[]): T[] {
  const merged = new Map(previous.map(option => [option.value, option]));
  incoming.forEach(option => merged.set(option.value, option));
  return Array.from(merged.values());
}

function stableOrder(rows: CountingLotRow[], order: string[]) {
  const rank = new Map(order.map((uid, index) => [uid, index]));
  return rows.slice().sort((left, right) => (rank.get(left.sourceUid) ?? Number.MAX_SAFE_INTEGER)
    - (rank.get(right.sourceUid) ?? Number.MAX_SAFE_INTEGER));
}

function inputKey(scopeKey: string, countType: CountingType, sourceUid: string) {
  return `${scopeKey}:${countInputKey(countType, sourceUid)}`;
}

function readKey(scope: string, type: CountingType, block: string, location: string, page: number, revision: string) {
  return JSON.stringify([scope, type, block, location, page, revision]);
}

function buildEntries(
  rows: CountingLotRow[],
  saved: Map<string, CountRow>,
  drafts: CountInputState,
  bridge: FieldCountingBridge,
  scope: Scope,
  direction: string,
  contextNote: string,
  order: string[],
  mode: SubmitMode,
  rowOrderOffset: number
): { entries: FieldCountingMutationEntry[]; invalidUids: string[] } {
  const ordered = stableOrder(rows, order);
  const invalidUids: string[] = [];
  const entries: FieldCountingMutationEntry[] = [];
  ordered.forEach((row, index) => {
    const key = inputKey(bridge.scopeKey, bridge.countType, row.sourceUid);
    const hasDraft = Object.prototype.hasOwnProperty.call(drafts, key);
    const raw = hasDraft ? drafts[key] : saved.get(row.sourceUid)?.countedQty == null ? '' : String(saved.get(row.sourceUid)!.countedQty);
    const parsed = parseWholeCount(raw);
    if (!parsed.valid) {
      invalidUids.push(row.sourceUid);
      return;
    }
    const prior = saved.get(row.sourceUid);
    const note = contextNote.trim() || prior?.note || '';
    if (parsed.value === null && (!prior || prior.countedQty === null)) return;
    const entry: FieldCountingMutationEntry = {
      sourceUid: row.sourceUid,
      countedQty: parsed.value ?? prior!.countedQty!,
      note,
      expectedUpdatedAt: prior?.updatedAt || null,
      rowOrder: rowOrderOffset + index + 1
    };
    const changed = !prior
      || parsed.value !== prior.countedQty
      || note !== prior.note
      || direction !== prior.direction
      || entry.rowOrder !== prior.rowOrder;
    if (mode === 'complete' || changed) entries.push(entry);
  });
  return { entries, invalidUids };
}

function CountingApp({ bridge, onExit }: { bridge: FieldCountingBridge; onExit?: () => void }) {
  const [countType, setCountType] = useState<CountingType>(bridge.countType);
  const [scope, setScope] = useState<Scope>({ block: '', location: '' });
  const [page, setPage] = useState(0);
  const [drafts, setDrafts] = useState<CountInputState>({});
  const [orders, setOrders] = useState<Record<string, string[]>>({});
  const [directions, setDirections] = useState<Record<string, string>>({});
  const [contextNotes, setContextNotes] = useState<Record<string, string>>({});
  const [blockOptions, setBlockOptions] = useState<Array<{ value: string; label: string; rowCount: number }>>([]);
  const [locationOptions, setLocationOptions] = useState<Array<{ value: string; label: string; rowCount: number }>>([]);
  const [busyMode, setBusyMode] = useState<SubmitMode | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const controllers = useRef(new Map<string, AbortController>());
  const operationToken = useRef(0);
  const pendingCommands = useRef(new Map<string, string>());
  const currentOwner = useRef('');
  const previousRevisionKey = useRef(bridge.revisionKey);
  const previousMasterRevision = useRef('');
  const currentContext = `${bridge.scopeKey}:${countType}:${scope.block}:${scope.location}`;
  currentOwner.current = currentContext;

  useEffect(() => {
    operationToken.current += 1;
    setCountType(bridge.countType);
    setScope({ block: '', location: '' });
    setPage(0);
    setDrafts({});
    setOrders({});
    setDirections({});
    setContextNotes({});
    setBlockOptions([]);
    setLocationOptions([]);
    pendingCommands.current.clear();
    setBusyMode(null);
    setMessage('');
    setError('');
  }, [bridge.scopeKey, bridge.countType]);

  useEffect(() => {
    if (previousRevisionKey.current === bridge.revisionKey) return;
    previousRevisionKey.current = bridge.revisionKey;
    setPage(0);
    setBlockOptions([]);
    setLocationOptions([]);
    setOrders({});
  }, [bridge.revisionKey]);

  const query: FieldCountingQuery = {
    countType, ...(scope.block ? { block: scope.block } : {}),
    ...(scope.location ? { location: scope.location } : {}), page
  };
  const key = bridge.scopeKey ? [bridge.scopeKey, countType, scope.block, scope.location, page, bridge.revisionKey] as const : null;
  const keyText = key ? readKey(...key) : '';
  const { data, error: loadError, isLoading, mutate: mutateCurrent } = useSWR<FieldCountingSnapshot>(
    key,
    async () => {
      const controller = new AbortController();
      controllers.current.get(keyText)?.abort();
      controllers.current.set(keyText, controller);
      try {
        return await bridge.readSnapshot({ ...query, signal: controller.signal });
      } finally {
        if (controllers.current.get(keyText) === controller) controllers.current.delete(keyText);
      }
    },
    { keepPreviousData: false, revalidateIfStale: true, revalidateOnFocus: true, revalidateOnReconnect: true, dedupingInterval: 0 }
  );

  useEffect(() => () => {
    const controller = controllers.current.get(keyText);
    controller?.abort();
    if (controller) controllers.current.delete(keyText);
  }, [keyText]);

  useEffect(() => () => {
    operationToken.current += 1;
    currentOwner.current = '';
    controllers.current.forEach(controller => controller.abort());
    controllers.current.clear();
  }, []);

  const snapshot = data;
  useEffect(() => {
    const masterRevision = String(snapshot?.masterRevision || '');
    if (!masterRevision || previousMasterRevision.current === masterRevision) return;
    previousMasterRevision.current = masterRevision;
    setPage(0);
    setBlockOptions([]);
    setLocationOptions([]);
    setOrders({});
  }, [snapshot?.masterRevision]);
  const saved = useMemo(() => countByUid(snapshot?.counts || []), [snapshot?.counts]);
  const orderedRowsKey = JSON.stringify([bridge.scopeKey, countType, scope.block, scope.location, page, bridge.revisionKey]);
  const orderedRows = useMemo(() => {
    const rows = (snapshot?.rows || []).slice();
    const explicitOrder = orders[orderedRowsKey];
    if (explicitOrder?.length) return stableOrder(rows, explicitOrder);
    return rows.map((row, index) => ({ row, index, savedOrder: saved.get(row.sourceUid)?.rowOrder }))
      .sort((left, right) => (left.savedOrder ?? Number.MAX_SAFE_INTEGER) - (right.savedOrder ?? Number.MAX_SAFE_INTEGER) || left.index - right.index)
      .map(entry => entry.row);
  }, [snapshot?.rows, orders, orderedRowsKey, saved]);
  const rowOrder = orders[orderedRowsKey] || orderedRows.map(row => row.sourceUid);
  useEffect(() => {
    if (!snapshot) return;
    if (!scope.block) setBlockOptions(current => mergeOptions(current, snapshot.options));
    else if (!scope.location) setLocationOptions(current => mergeOptions(current, snapshot.options));
  }, [snapshot, scope.block, scope.location]);
  const currentDirectionKey = `${bridge.scopeKey}:${countType}:${scope.block}:${scope.location}`;
  const allowed = allowedDirections(scope);
  const priorDirection = orderedRows.map(row => saved.get(row.sourceUid)?.direction).find(value => allowed.some(item => item.key === value));
  const direction = directions[currentDirectionKey] || priorDirection || allowed[0]?.key || 'east_west';
  const contextNote = contextNotes[currentDirectionKey] || '';
  const built = buildEntries(orderedRows, saved, drafts, { ...bridge, countType }, scope, direction, contextNote, rowOrder, 'save', page * PAGE_SIZE);
  const hasErrors = built.invalidUids.length > 0;
  const hasChanges = built.entries.length > 0;
  const completable = buildEntries(orderedRows, saved, drafts, { ...bridge, countType }, scope, direction, contextNote, rowOrder, 'complete', page * PAGE_SIZE);
  const options = !scope.block ? blockOptions : !scope.location ? locationOptions : [];
  const selectedBlockOption = blockOptions.find(option => option.value === scope.block);
  const selectedLocationOption = locationOptions.find(option => option.value === scope.location);

  function setDraft(row: CountingLotRow, event: ChangeEvent<HTMLInputElement>) {
    const value = event.currentTarget.value;
    setDrafts(current => ({ ...current, [inputKey(bridge.scopeKey, countType, row.sourceUid)]: value }));
    setError('');
    setMessage('');
  }

  function focusNextInput(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const inputs = Array.from(event.currentTarget.closest('[data-counting-rows]')?.querySelectorAll<HTMLInputElement>('input[data-count-input]') || []);
    const index = inputs.indexOf(event.currentTarget);
    inputs[index + 1]?.focus();
  }

  function changeType(next: CountingType) {
    if (busyMode) return;
    setCountType(next);
    setScope({ block: '', location: '' });
    setPage(0);
    setBlockOptions([]);
    setLocationOptions([]);
    setOrders({});
    setMessage('');
    setError('');
  }

  function changeBlock(block: string) {
    setScope({ block, location: '' });
    setPage(0);
    setLocationOptions([]);
    setOrders({});
    setMessage('');
    setError('');
  }

  function changeLocation(location: string) {
    setScope(current => ({ ...current, location }));
    setPage(0);
    setOrders({});
    setMessage('');
    setError('');
  }

  function shiftRow(sourceUid: string, delta: -1 | 1) {
    const pageRows = orderedRows;
    const currentPageIndex = pageRows.findIndex(row => row.sourceUid === sourceUid);
    const neighborUid = pageRows[currentPageIndex + delta]?.sourceUid;
    if (currentPageIndex < 0 || !neighborUid) return;
    const currentOrder = orders[orderedRowsKey] || orderedRows.map(row => row.sourceUid);
    const moving = currentOrder.indexOf(sourceUid);
    const neighbor = currentOrder.indexOf(neighborUid);
    if (moving < 0 || neighbor < 0) return;
    const globalOrder = currentOrder.slice();
    [globalOrder[moving], globalOrder[neighbor]] = [globalOrder[neighbor], globalOrder[moving]];
    setOrders(current => ({ ...current, [orderedRowsKey]: globalOrder }));
  }

  async function submit(mode: SubmitMode) {
    if (busyMode || !snapshot || !scope.block || !scope.location) return;
    const prepared = buildEntries(orderedRows, saved, drafts, { ...bridge, countType }, scope, direction, contextNote, rowOrder, mode, page * PAGE_SIZE);
    if (prepared.invalidUids.length) {
      setError('Counts must be whole numbers greater than or equal to zero.');
      return;
    }
    if (!prepared.entries.length) {
      setError(mode === 'save' ? 'Enter or change a count before saving.' : 'Enter at least one count before completing this batch.');
      return;
    }
    const payloadWithoutId: Omit<FieldCountingMutation, 'idempotencyKey'> = {
      countType,
      scope: { block: scope.block, location: scope.location },
      direction,
      entries: prepared.entries
    };
    const command = stableCommandId(mode, payloadWithoutId, pendingCommands.current);
    pendingCommands.current.set(command.fingerprint, command.commandId);
    const payload: FieldCountingMutation = { ...payloadWithoutId, idempotencyKey: command.commandId };
    const owner = `${bridge.scopeKey}:${countType}:${scope.block}:${scope.location}`;
    const token = ++operationToken.current;
    setBusyMode(mode);
    setError('');
    setMessage('');
    try {
      const receipt = mode === 'save' ? await bridge.saveCounts(payload) : await bridge.completeAndEmail(payload);
      if (owner !== currentOwner.current || token !== operationToken.current) return;
      if (!receipt || !String(receipt.revision || '').trim()
        || prepared.entries.some(entry => !receipt.savedSourceUids.includes(entry.sourceUid))
        || (mode === 'complete' && (!receipt.reportId || receipt.deliveryStatus !== 'queued'))) {
        throw new Error('The server did not confirm every count. Your entries remain on screen; refresh and review before retrying.');
      }
      const confirmedDraftKeys = new Set(prepared.entries.map(entry => inputKey(bridge.scopeKey, countType, entry.sourceUid)));
      pendingCommands.current.delete(command.fingerprint);
      setDrafts(current => Object.fromEntries(Object.entries(current).filter(([draftKey]) => {
        return !confirmedDraftKeys.has(draftKey);
      })));
      setMessage(mode === 'save' ? 'Counts saved.' : `Count report queued${receipt.reportId ? ` (${receipt.reportId})` : ''}.`);
      await mutateCurrent();
    } catch (submitError) {
      if (owner !== currentOwner.current || token !== operationToken.current) return;
      setError(submitError instanceof Error ? submitError.message : 'Counts could not be saved. Your entries remain on screen.');
    } finally {
      if (token === operationToken.current) setBusyMode(null);
    }
  }

  const optionsLoading = isLoading && !snapshot;
  const displayError = error || (loadError instanceof Error ? loadError.message : '');
  return <main className="field-counting" aria-label="Field counting">
    <header className="field-counting__header">
      <div>
        <p className="field-counting__eyebrow">Inventory · Field entry</p>
        <h1>Counting</h1>
        <p className="field-counting__subhead">Record counts by location and lot. Counts do not change inventory quantities.</p>
      </div>
      {onExit && <button type="button" className="field-counting__back" onClick={onExit}>Back to Inventory</button>}
      <div className="field-counting__type-switch" role="group" aria-label="Count type">
        <button type="button" aria-pressed={countType === 'bunch'} disabled={!!busyMode} onClick={() => changeType('bunch')}>Bunch Count</button>
        <button type="button" aria-pressed={countType === 'spread'} disabled={!!busyMode} onClick={() => changeType('spread')}>Spread Count</button>
      </div>
    </header>

    <section className="field-counting__scope" aria-label="Counting location">
      <label>Block
        <select value={scope.block} disabled={!!busyMode || optionsLoading} onChange={event => changeBlock(event.currentTarget.value)}>
          <option value="">Choose block</option>
          {scope.block && !options.some(option => option.value === scope.block)
            ? <option value={scope.block}>{selectedBlockOption ? `${selectedBlockOption.label} · ${selectedBlockOption.rowCount}` : scope.block}</option> : null}
          {(!scope.block ? options : []).map(option => <option key={option.value} value={option.value}>{option.label} · {option.rowCount}</option>)}
        </select>
      </label>
      {scope.block && <label>Location
        <select value={scope.location} disabled={!!busyMode || optionsLoading} onChange={event => changeLocation(event.currentTarget.value)}>
          <option value="">Choose location</option>
          {scope.location && !options.some(option => option.value === scope.location)
            ? <option value={scope.location}>{selectedLocationOption ? `${selectedLocationOption.label} · ${selectedLocationOption.rowCount}` : scope.location}</option> : null}
          {(scope.block && !scope.location ? options : []).map(option => <option key={option.value} value={option.value}>{option.label} · {option.rowCount}</option>)}
        </select>
      </label>}
      {scope.location && <div className="field-counting__scope-summary"><strong>{scope.block}</strong><span>{scope.location}</span><span>{snapshot?.total ?? 0} lots</span></div>}
    </section>

    {displayError && <div className="field-counting__notice field-counting__notice--error" role="alert">{displayError}
      <button type="button" onClick={() => { setError(''); void mutateCurrent(); }}>Refresh source data</button>
    </div>}
    {message && <div className="field-counting__notice" role="status">{message}</div>}
    {optionsLoading && <div className="field-counting__empty" role="status">Loading current count data…</div>}
    {loadError && snapshot && <div className="field-counting__notice field-counting__notice--error" role="status">Refresh failed. Saved values and your unsaved entries are still shown. {loadError.message}</div>}

    {!scope.location && snapshot && <div className="field-counting__pager" aria-label="Counting options pages">
      <span>{snapshot.total ? `Showing ${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + snapshot.options.length} of ${snapshot.total}` : ''}</span>
      {!snapshot.complete && <button type="button" disabled={!!busyMode || isLoading} onClick={() => setPage(current => current + 1)}>Load next {PAGE_SIZE}</button>}
      {page > 0 && <button type="button" disabled={!!busyMode} onClick={() => setPage(current => Math.max(0, current - 1))}>Previous {PAGE_SIZE}</button>}
    </div>}

    {scope.location && <>
      <section className="field-counting__controls" aria-label="Location count settings">
        <label>Row direction
          <select value={direction} disabled={!!busyMode} onChange={event => {
            const value = event.currentTarget.value;
            setDirections(current => ({ ...current, [currentDirectionKey]: value }));
          }}>
            {allowed.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
        <label className="field-counting__context-note">Location note (optional)
          <textarea rows={2} maxLength={500} value={contextNote} disabled={!!busyMode} placeholder="Add a note to this multi-row count batch" onChange={event => {
            const value = event.currentTarget.value;
            setContextNotes(current => ({ ...current, [currentDirectionKey]: value }));
          }} />
        </label>
      </section>
      <div className="field-counting__rows" data-counting-rows>
        {(orderedRows).map((row, index) => {
          const key = inputKey(bridge.scopeKey, countType, row.sourceUid);
          const value = Object.prototype.hasOwnProperty.call(drafts, key)
            ? drafts[key]
            : saved.get(row.sourceUid)?.countedQty == null ? '' : String(saved.get(row.sourceUid)!.countedQty);
          const parsed = parseWholeCount(value);
          const previous = saved.get(row.sourceUid);
          return <article className="field-counting__row" key={row.sourceUid} data-source-uid={row.sourceUid}>
            <div className="field-counting__row-title">
          <span className="field-counting__row-number">{page * PAGE_SIZE + index + 1}</span>
              <div className="field-counting__row-name"><h2>{row.commonname}</h2><p>{row.itemcode} · {row.contsize || 'Size unknown'}</p></div>
              <span className="field-counting__lot">{row.lotcode}</span>
            </div>
            <dl className="field-counting__row-details">
              <div><dt>Season</dt><dd>{row.season || '—'}</dd></div>
              <div><dt>On hand</dt><dd>{row.onHand ?? 'Unknown'}</dd></div>
            </dl>
            <div className="field-counting__entry">
              <label>Count
                  <input data-count-input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={9} autoComplete="off" enterKeyHint="next"
                  aria-label={`Count ${row.commonname}, ${row.lotcode}`} value={value} disabled={!!busyMode}
                  aria-invalid={!parsed.valid} onChange={event => setDraft(row, event)} onKeyDown={focusNextInput} />
              </label>
              <div className="field-counting__row-order" aria-label={`Order ${row.commonname}`}>
                <button type="button" aria-label={`Move ${row.commonname} up`} disabled={!!busyMode || index === 0} onClick={() => shiftRow(row.sourceUid, -1)}>↑</button>
                <button type="button" aria-label={`Move ${row.commonname} down`} disabled={!!busyMode || index === orderedRows.length - 1} onClick={() => shiftRow(row.sourceUid, 1)}>↓</button>
              </div>
            </div>
            {previous && <p className="field-counting__saved">Saved {previous.countedQty ?? '—'}{previous.actor ? ` · ${previous.actor}` : ''}{previous.updatedAt ? ` · ${previous.updatedAt}` : ''}</p>}
          </article>;
        })}
        {scope.location && !optionsLoading && !orderedRows.length && <div className="field-counting__empty">No lots are available in this location.</div>}
      </div>
      <div className="field-counting__pager">
        <span>{snapshot ? `Showing ${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + snapshot.rows.length} of ${snapshot.total}` : ''}</span>
        {!snapshot?.complete && <button type="button" disabled={!!busyMode || isLoading} onClick={() => setPage(current => current + 1)}>Load next {PAGE_SIZE}</button>}
        {page > 0 && <button type="button" disabled={!!busyMode} onClick={() => setPage(current => Math.max(0, current - 1))}>Previous {PAGE_SIZE}</button>}
      </div>
      <footer className="field-counting__actions">
        <button type="button" className="field-counting__save" disabled={!!busyMode || hasErrors || !hasChanges} onClick={() => void submit('save')}>
          {busyMode === 'save' ? 'Saving…' : 'Save this page'}
        </button>
        <button type="button" className="field-counting__complete" disabled={!!busyMode || completable.invalidUids.length > 0 || !completable.entries.length} onClick={() => void submit('complete')}>
          {busyMode === 'complete' ? 'Completing…' : 'Complete this page & email report'}
        </button>
      </footer>
      <p className="field-counting__subhead">Save or complete applies to this page only. Drafts on other pages stay available.</p>
    </>}
  </main>;
}

export function FieldCountingView({ bridge, onExit }: { bridge: FieldCountingBridge; onExit?: () => void }) {
  const provider = useMemo(() => {
    const cache: Cache<unknown> = new Map<string, State<unknown, Error>>();
    return () => cache;
  }, [bridge.scopeKey]);
  const config = useMemo(() => ({ provider }), [provider]);
  return <SWRConfig value={config}><CountingApp key={bridge.scopeKey} bridge={bridge} onExit={onExit} /></SWRConfig>;
}
