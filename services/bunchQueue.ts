import type { BunchPerson, BunchQueueFilter, BunchQueuePage, BunchReview, BunchReviewPage, BunchWorkCard, BunchMutation, BunchQueueTransport } from '../components/bunch-queue/contract';

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Bunch Notes response. Refresh before continuing.');
  return value as Record<string, unknown>;
};
const text = (value: unknown): string => { if (typeof value !== 'string') throw new Error('Invalid Bunch Notes text.'); return value; };
const number = (value: unknown): number => { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid Bunch Notes quantity.'); return value; };
const integer = (value: unknown): number => { const result = number(value); if (!Number.isSafeInteger(result) || result < 0) throw new Error('Invalid Bunch Notes revision.'); return result; };
const permission = (value: unknown): boolean => { if (value == null) return false; if (typeof value !== 'boolean') throw new Error('Invalid Bunch Notes permission.'); return value; };
const nullableNumber = (value: unknown): number | null => value == null ? null : number(value);
const list = (value: unknown, limit = 100): unknown[] => { if (!Array.isArray(value) || value.length > limit) throw new Error('Invalid Bunch Notes page.'); return value; };
const person = (value: unknown): BunchPerson => { const row = object(value); return { id: text(row.id), username: text(row.username), display_name: text(row.display_name) }; };
export function parseBunchCard(value: unknown): BunchWorkCard {
  const row = object(value), status = text(row.status);
  if (!['open', 'complete', 'cancelled'].includes(status)) throw new Error('Invalid Bunch Notes status.');
  const sources = list(row.sources, 1000).map(value => { const source = object(value); return { row_id: text(source.row_id), location: text(source.location), lot: text(source.lot), ptravailable: nullableNumber(source.ptravailable), actual_qty: nullableNumber(source.actual_qty) }; });
  if (new Set(sources.map(source => source.row_id)).size !== sources.length) throw new Error('Duplicate Bunch Notes source rows.');
  return { stablecard_id: text(row.stablecard_id), job_id: text(row.job_id), card_id: text(row.card_id), revision: integer(row.revision), job_revision: integer(row.job_revision), status: status as BunchWorkCard['status'], can_complete: permission(row.can_complete), itemcode: text(row.itemcode), variety: text(row.variety), contsize: text(row.contsize), source_location: text(row.source_location), lot: text(row.lot), ptravailable: nullableNumber(row.ptravailable), action: text(row.action), destination: text(row.destination), notes: text(row.notes), assignees: list(row.assignees, 1000).map(person), sources };
}
export function parseBunchQueue(value: unknown): BunchQueuePage {
  const row = object(value), cards = list(row.cards).map(parseBunchCard);
  if (new Set(cards.map(card => card.stablecard_id)).size !== cards.length) throw new Error('Duplicate Bunch Notes cards.');
  const assigneeOptions = list(row.assignee_options ?? [], 1000).map(value => {
    const option = object(value);
    return { ...person(option), count: integer(option.count) };
  });
  if (new Set(assigneeOptions.map(option => option.id)).size !== assigneeOptions.length) throw new Error('Duplicate Bunch Notes assignee options.');
  return { cards, total: integer(row.total), active_count: integer(row.active_count), review_count: integer(row.review_count), can_review: permission(row.can_review), counters: list(row.counters, 1000).map(person), assignee_options: assigneeOptions, unassigned_count: integer(row.unassigned_count ?? 0) };
}
export function parseBunchReviews(value: unknown): BunchReviewPage {
  const row = object(value);
  const reviews = list(row.reviews).map((value): BunchReview => {
    const review = object(value);
    return { sources: list(review.sources, 1000).map(value => { const source = object(value); return { row_id: text(source.row_id), location: text(source.location), lot: text(source.lot), actual_qty: nullableNumber(source.actual_qty), ptravailable: nullableNumber(source.ptravailable) }; }), id: text(review.id), revision: integer(review.revision), status: text(review.status), job_id: text(review.job_id), card_id: text(review.card_id), itemcode: text(review.itemcode), variety: text(review.variety), contsize: text(review.contsize), source_location: text(review.source_location), destination: text(review.destination), completed_by: text(review.completed_by), actual_qty: number(review.actual_qty), ptravailable: nullableNumber(review.ptravailable), variance: nullableNumber(review.variance), assigned_counter_id: review.assigned_counter_id == null ? null : text(review.assigned_counter_id), assigned_counter_username: review.assigned_counter_username == null ? null : text(review.assigned_counter_username), recount_qty: nullableNumber(review.recount_qty), can_assign: permission(review.can_assign), can_complete: permission(review.can_complete) };
  });
  return { reviews, total: integer(row.total), review_count: integer(row.review_count), can_review: permission(row.can_review), counters: list(row.counters, 1000).map(person) };
}
export function actualQuantity(value: string): number {
  if (!/^\d+$/.test(value.trim())) throw new Error('Enter the actual whole quantity, including zero when appropriate.');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result > 999_999_999) throw new Error('Quantity must be between zero and 999,999,999.');
  return result;
}

export type BunchQueueSnapshot = {
  page: BunchQueuePage | null; reviews: BunchReviewPage | null; filter: BunchQueueFilter; loadedFilter: BunchQueueFilter | null; offset: number;
  loading: boolean; error: string; message: string; offline: boolean; pending: BunchMutation[];
};
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
class RejectedCommand extends Error {}
export function createBunchQueueClient({ scopeKey, cacheScopeKey = scopeKey, transport, storage, onCounts, online = () => navigator.onLine !== false, uuid = () => crypto.randomUUID() }: {
  scopeKey: string; cacheScopeKey?: string; transport: BunchQueueTransport; storage?: StorageLike;
  onCounts?: (counts: { active: number; review: number; canReview: boolean }) => void; online?: () => boolean; uuid?: () => string;
}) {
  if (!scopeKey) throw new Error('Sign in to load Bunch Notes.');
  const key = `gnc:bunch-queue:v230:${scopeKey}`, legacyCacheKey = `gnc:bunch-queue:v230:${cacheScopeKey}`;
  const cacheKey = `gnc:bunch-queue:v232:${cacheScopeKey}`, listeners = new Set<() => void>();
  let disposed = false, loadingId = 0, mutationEpoch = 0, flushing = false, outboxBlocked = false;
  let sourcePage: BunchQueuePage | null = null;
  const completed = new Map<string, number>();
  const controller = new AbortController();
  let state: BunchQueueSnapshot = { page: null, reviews: null, filter: 'all', loadedFilter: null, offset: 0, loading: false, error: '', message: '', offline: !online(), pending: [] };
  const storageKey = (suffix: string) => (suffix === ':outbox' || suffix === ':last-rejected' || suffix.startsWith(':draft:') ? key : cacheKey) + suffix;
  const read = (suffix: string): unknown => { try { return JSON.parse(storage?.getItem(storageKey(suffix)) || 'null'); } catch { return null; } };
  const persist = (suffix: string, value: unknown, required = false) => {
    try { if (!storage && required) throw new Error('Storage unavailable'); storage?.setItem(storageKey(suffix), JSON.stringify(value)); }
    catch { if (required) throw new Error('Your device could not retain this work. Free storage and retry before leaving this screen.'); }
  };
  // Keep server/cache snapshots intact so a rejected receipt restores its row.
  // Successful receipts remain masked in older offline snapshots after restart.
  const projectPage = (page: BunchQueuePage | null, pending: BunchMutation[]): BunchQueuePage | null => {
    if (!page) return page;
    const pendingTargets = new Set(pending.filter(command => command.operation === 'complete_card').map(command => command.target));
    const removed = page.cards.filter(card => card.status === 'open' && (pendingTargets.has(card.stablecard_id) || card.revision <= (completed.get(card.stablecard_id) ?? -1)));
    if (!removed.length) return page;
    return {
      ...page,
      cards: page.cards.filter(card => !removed.includes(card)),
      total: Math.max(0, page.total - removed.length),
      active_count: Math.max(0, page.active_count - removed.length),
      assignee_options: page.assignee_options.map(person => ({ ...person, count: Math.max(0, person.count - removed.filter(card => card.assignees.some(assignee => assignee.id === person.id)).length) })).filter(person => person.count > 0),
      unassigned_count: Math.max(0, page.unassigned_count - removed.filter(card => !card.assignees.length).length),
    };
  };
  const invalidateReads = () => { loadingId++; mutationEpoch++; };
  const publish = (patch: Partial<BunchQueueSnapshot>) => {
    if (disposed) return;
    if ('page' in patch) sourcePage = patch.page ?? null;
    state = { ...state, ...patch };
    state.page = projectPage(sourcePage, state.pending);
    onCounts?.({ active: state.page?.active_count ?? 0, review: state.reviews?.review_count ?? state.page?.review_count ?? 0, canReview: !!(state.page?.can_review || state.reviews?.can_review || state.page?.review_count || state.reviews?.review_count) });
    listeners.forEach(listener => listener());
  };
  try {
    const cached = read(':all:0');
    if (cached) { state.page = parseBunchQueue(cached); state.loadedFilter = 'all'; }
    else {
      const legacyMine = JSON.parse(storage?.getItem(`${legacyCacheKey}:mine:0`) || 'null');
      if (legacyMine) { state.page = parseBunchQueue(legacyMine); state.filter = 'mine'; state.loadedFilter = 'mine'; }
    }
  } catch { /* Re-read invalid cached snapshots. */ }
  try {
    state.pending = list(JSON.parse(storage?.getItem(key + ':outbox') || '[]'), 500).map(value => {
      const command = object(value), operation = text(command.operation);
      if (!['complete_card', 'assign_counter', 'complete_recount'].includes(operation)) throw new Error('Invalid pending operation.');
      return { operation: operation as BunchMutation['operation'], payload: object(command.payload), commandId: text(command.commandId), expectedRevision: integer(command.expectedRevision), target: text(command.target) };
    });
  } catch { outboxBlocked = true; state.error = 'Saved pending work could not be read. It has been retained on this device.'; }
  try {
    const saved = read(':completed');
    if (saved != null) {
      if (!Array.isArray(saved)) throw new Error('Invalid completed receipts.');
      saved.forEach(value => { const receipt = object(value); completed.set(text(receipt.target), integer(receipt.revision)); });
    }
  } catch { /* The server remains authoritative if an optional completion cache is damaged. */ }
  sourcePage = state.page;
  state.page = projectPage(sourcePage, state.pending);
  async function call(operation: string, payload: Record<string, unknown>, command?: BunchMutation) {
    if (disposed) throw new Error('The signed-in session changed.');
    let result: unknown;
    try {
      result = await transport({ action: 'bunch_note_workflow', operation, payload, ...(command ? { commandId: command.commandId, expectedRevision: command.expectedRevision } : {}) }, controller.signal);
    } catch (error) {
      // The shell transport throws structured HTTP errors. Only a definite
      // server rejection may release pending work; uncertain delivery keeps it.
      const failure = error && typeof error === 'object' ? error as Record<string, unknown> : {};
      const body = failure.payload && typeof failure.payload === 'object' ? failure.payload as Record<string, unknown> : {};
      if ([400, 403, 409].includes(Number(failure.status)) && typeof body.code === 'string' && /^BUNCH_NOTE_[A-Z_]+$/.test(body.code)) {
        throw new RejectedCommand(body.code);
      }
      throw error;
    }
    const response = object(result);
    if (disposed) throw new Error('The signed-in session changed.');
    if (response.ok !== true) throw new RejectedCommand(typeof response.message === 'string' ? response.message : 'The work was not accepted. Refresh and review your entries.');
    return response.data;
  }
  async function load(filter: BunchQueueFilter = state.filter, offset = state.offset, reviews = false) {
    const generation = ++loadingId;
    const suffix = reviews ? `:reviews:${offset}` : `:${filter}:${offset}`;
    const cached = read(suffix) ?? (reviews ? (() => {
      // Review snapshots did not change shape in v232. Preserve same-user v230
      // offline access even when the permission-scoped cache namespace changed.
      try { return JSON.parse(storage?.getItem(legacyCacheKey + suffix) || 'null'); } catch { return null; }
    })() : null);
    try { if (cached) publish(reviews ? { reviews: parseBunchReviews(cached) } : { page: parseBunchQueue(cached), loadedFilter: filter }); } catch { /* Keep the last valid snapshot. */ }
    publish({ filter, offset, loading: online(), offline: !online(), error: outboxBlocked ? 'Saved pending work could not be read. It has been retained on this device.' : '' });
    if (!online()) return;
    try {
      const data = object(await call(reviews ? 'list_discrepancies' : 'queue', { filter, offset, limit: 100 }));
      if (generation !== loadingId || disposed) return;
      if (data?.retained === true) return;
      const page = reviews ? parseBunchReviews(data) : parseBunchQueue(data);
      persist(suffix, page);
      publish(reviews ? { reviews: page as BunchReviewPage } : { page: page as BunchQueuePage, loadedFilter: filter });
    } catch (error) { if (generation === loadingId) publish({ error: error instanceof Error ? error.message : 'Unable to refresh work. Your entries are retained.' }); }
    finally { if (generation === loadingId) publish({ loading: false, offline: !online() }); }
  }
  async function flush() {
    if (flushing || disposed || !online()) return;
    flushing = true;
    try {
      while (state.pending.length) {
        const command = state.pending[0];
        if (disposed || !online()) break;
        try {
          await call(command.operation, command.payload, command);
          if (command.operation === 'complete_card') {
            const confirmed = new Map(completed).set(command.target, command.expectedRevision);
            persist(':completed', [...confirmed].map(([target, revision]) => ({ target, revision })), true);
            completed.set(command.target, command.expectedRevision);
          }
          const pending = state.pending.filter(item => item.commandId !== command.commandId);
          persist(':outbox', pending, true);
          invalidateReads();
          publish({ pending, loading: false, message: command.operation === 'complete_card' ? 'Work completed. Completion email queued; any variance was routed for recount.' : 'Recount update saved.', error: '' });
        } catch (error) {
          if (error instanceof RejectedCommand) {
            try {
              persist(':last-rejected', { command, error: error.message, at: new Date().toISOString() }, true);
              const pending = state.pending.filter(item => item.commandId !== command.commandId);
              persist(':outbox', pending, true);
              invalidateReads();
              publish({ pending, loading: false, error: error.message, message: '' });
            } catch (storageError) {
              publish({ error: `${error.message}. ${storageError instanceof Error ? storageError.message : 'Unable to retain the rejection.'} The saved request is retained for recovery.`, message: '' });
            }
          } else publish({ error: 'Completion is not confirmed. Your saved request will retry with the same receipt; do not submit it again.' });
          break;
        }
      }
    } finally { flushing = false; publish({ offline: !online() }); }
  }
  async function mutate(operation: BunchMutation['operation'], payload: Record<string, unknown>, expectedRevision: number, target: string) {
    if (outboxBlocked) throw new Error('Saved pending work needs recovery before new completions can be recorded.');
    if (state.pending.some(command => command.target === target)) return flush();
    const command = { operation, payload, expectedRevision, target, commandId: uuid() };
    const pending = [...state.pending, command];
    persist(':outbox', pending, true);
    invalidateReads();
    publish({ pending, loading: false, error: '', message: online() ? 'Saving work…' : 'Saved on this device. Completion will be confirmed when you reconnect.', offline: !online() });
    await flush();
    if (state.error) throw new Error(state.error);
  }
  return {
    scopeKey,
    async stage(reviews = false, signal?: AbortSignal) {
      const filter = state.filter, offset = state.offset, epoch = mutationEpoch;
      const response = object(await transport({ action: 'bunch_note_workflow', operation: reviews ? 'list_discrepancies' : 'queue', payload: { filter, offset, limit: 100 } }, signal || controller.signal));
      if (response.ok !== true) throw new Error(typeof response.message === 'string' ? response.message : 'Unable to refresh Bunch Notes.');
      return { scopeKey, filter, offset, reviews, epoch, data: reviews ? parseBunchReviews(response.data) : parseBunchQueue(response.data) };
    },
    commit(value: { scopeKey: string; filter: BunchQueueFilter; offset: number; reviews: boolean; epoch: number; data: BunchQueuePage | BunchReviewPage }) {
      if (disposed || value.epoch !== mutationEpoch || value.scopeKey !== scopeKey || value.filter !== state.filter || value.offset !== state.offset) return;
      persist(value.reviews ? ':reviews:' + value.offset : ':' + value.filter + ':' + value.offset, value.data);
      publish(value.reviews ? { reviews: value.data as BunchReviewPage } : { page: value.data as BunchQueuePage, loadedFilter: value.filter });
    },
    setFilter(filter: BunchQueueFilter) {
      const fullAuthorizedQueueLoaded = state.loadedFilter === 'all' && state.offset === 0 && !!state.page && state.page.total <= state.page.cards.length;
      if (filter === 'all' && state.loadedFilter === 'all' && fullAuthorizedQueueLoaded) {
        loadingId++;
        publish({ filter, offset: 0, loading: false });
        return;
      }
      if (fullAuthorizedQueueLoaded && (filter === 'unassigned' || filter.startsWith('assignee:'))) {
        loadingId++;
        publish({ filter, offset: 0, loading: false });
        return;
      }
      void load(filter, 0);
    },
    getSnapshot: () => state, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); }, load, flush, mutate,
    draft(target: string): Record<string, string> { const saved = read(':draft:' + target); if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}; return Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, string] => typeof entry[1] === 'string')); },
    saveDraft(target: string, value: Record<string, string>) { persist(':draft:' + target, value); },
    dispose() { disposed = true; controller.abort(); listeners.clear(); }
  };
}
export type BunchQueueClient = ReturnType<typeof createBunchQueueClient>;
