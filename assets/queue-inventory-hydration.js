(function (root) {
    'use strict';
    const text = value => String(value ?? '').trim().toUpperCase();
    const pick = (row, ...keys) => keys.map(key => row?.[key]).find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? '';
    function normalizeItem(value) {
        const key = text(value);
        if (/^\d{6}\.\d{3}\.\d$/.test(key)) return key.replace(/\./g, '');
        return /^\d{1,10}$/.test(key) ? key.padStart(10, '0') : key;
    }
    function normalizeLocation(value) {
        const key = text(value).replace(/\s*\.\s*/g, '.');
        const match = /^([A-Z]+)\.(\d{1,2})\.(\d{1,3})$/.exec(key);
        return match ? `${match[1]}.${match[2].padStart(2, '0')}.${match[3].padStart(3, '0')}` : key;
    }
    function identity(row = {}) {
        const source = text(pick(row, 'source', 'MASTER_SOURCE', 'master_source', 'SOURCECODE', 'sourcecode', 'SOURCE_CODE', 'source_code', 'SOURCE'));
        return {
            masterUid: String(pick(row, 'masterUid', 'MASTER_UNIQUE_ID', 'master_unique_id', 'MASTER_ID', 'master_id')).trim(),
            itemCode: normalizeItem(pick(row, 'itemCode', 'ITEMCODE', 'itemcode', 'ITEM', 'item')),
            locationCode: normalizeLocation(pick(row, 'locationCode', 'LOCATIONCODE', 'locationcode', 'LOCATION', 'location')),
            lotCode: text(pick(row, 'lotCode', 'LOTCODE', 'lotcode', 'LOT', 'lot')),
            source: ['DOCK', 'DOCKS', 'SOC'].includes(source) ? '' : source
        };
    }
    function matches(row, input) {
        if (!row || !input) return false;
        const wanted = identity(input), actual = identity(row);
        const uid = String(pick(row, 'UNIQUE_ID', 'unique_id')).trim();
        if (wanted.masterUid && uid !== wanted.masterUid) return false;
        if (!wanted.masterUid && (!wanted.itemCode || !wanted.locationCode)) return false;
        return (!wanted.itemCode || actual.itemCode === wanted.itemCode)
            && (!wanted.locationCode || actual.locationCode === wanted.locationCode)
            && ((wanted.masterUid && !wanted.lotCode) || actual.lotCode === wanted.lotCode)
            && (!wanted.source || actual.source === wanted.source);
    }
    const locationLotKey = value => { const i = identity(value); return JSON.stringify([i.itemCode, i.locationCode, i.lotCode]); };
    function createIndex(rows = []) {
        const ids = new Map(), keys = new Map();
        for (const row of rows) {
            const uid = String(pick(row, 'UNIQUE_ID', 'unique_id')).trim();
            if (!uid || ids.has(uid)) continue;
            ids.set(uid, row);
            const key = locationLotKey(row);
            if (!keys.has(key)) keys.set(key, []);
            keys.get(key).push(row);
        }
        return { resolve(input) {
            const i = identity(input);
            const candidates = i.masterUid ? [ids.get(i.masterUid)].filter(Boolean) : keys.get(locationLotKey(i)) || [];
            const exact = candidates.filter(row => matches(row, i));
            return { status: exact.length === 1 ? 'ready' : exact.length ? 'ambiguous' : 'missing', row: exact.length === 1 ? exact[0] : null };
        } };
    }
    function createHydrator(options) {
        let entries = new Map(), pending = new Map(), active = null, timer = null, generation = 0, scope = '';
        const inflight = new Set();
        const contextKey = c => c ? JSON.stringify([c.scope, c.permission]) : '';
        const current = () => {
            const c = options.context();
            const next = contextKey(c);
            if (scope !== next) { invalidate(); scope = next; }
            return c && c.scope && c.permission && !c.signal?.aborted ? c : null;
        };
        const entryKey = value => JSON.stringify(identity(value));
        function invalidate() {
            generation++; entries.clear(); pending.clear(); inflight.clear();
            if (timer !== null) clearTimeout(timer);
            timer = null;
        }
        function schedule() {
            if (timer !== null || active) return;
            timer = setTimeout(() => { timer = null; void flush(); }, 0);
        }
        function read(input) {
            const c = current();
            if (!c) return { status: 'unavailable', row: null };
            const value = identity(input), key = entryKey(value), entry = entries.get(key);
            if (!value.masterUid && (!value.itemCode || !value.locationCode)) return { status:'missing', row:null };
            const fresh = entry && entry.revision === String(c.revision || '') && Date.now() - entry.at < (options.ttlMs || 120000);
            if (fresh) return entry;
            if (!inflight.has(key)) pending.set(key, value);
            schedule();
            // A revision mismatch cannot serve a previously verified stock value.
            return { status: 'loading', row: null };
        }
        async function flush() {
            if (timer !== null) clearTimeout(timer);
            timer = null;
            if (active) return active;
            const c = current();
            if (!c || !pending.size) return;
            const batch = [...pending].slice(0, 100);
            batch.forEach(([key]) => { pending.delete(key); inflight.add(key); });
            const epoch = generation;
            const isCurrent = () => {
                const now = current();
                return epoch === generation && now && contextKey(now) === contextKey(c)
                    && now.signal === c.signal && !c.signal?.aborted && String(now.revision || '') === String(c.revision || '');
            };
            active = (async () => {
                try {
                    const results = await options.load(batch.map(([, i]) => i), c);
                    if (!isCurrent()) return;
                    if (!Array.isArray(results) || results.length !== batch.length) throw new Error('Inventory batch was incomplete.');
                    const seen = new Set();
                    const accepted = results.map(result => {
                        const index = result.inputIndex;
                        if (!Number.isInteger(index) || index < 0 || index >= batch.length || seen.has(index) || ![0,1,2].includes(result.matchCount)) throw new Error('Inventory batch identity was invalid.');
                        seen.add(index);
                        if (result.matchCount === 1 && !matches(result.row, batch[index][1])) throw new Error('Inventory identity changed during verification.');
                        return [batch[index][0], { status: result.matchCount === 1 ? 'ready' : result.matchCount === 2 ? 'ambiguous' : 'missing', row: result.matchCount === 1 ? result.row : null }];
                    });
                    accepted.forEach(([key, result]) => entries.set(key, { ...result, revision:String(c.revision || ''), at:Date.now() }));
                } catch (error) {
                    if (isCurrent()) batch.forEach(([key]) => entries.set(key, { status:'error', row:null, error, revision:String(c.revision || ''), at:Date.now() - (options.ttlMs || 120000) + 30000 }));
                } finally {
                    batch.forEach(([key]) => inflight.delete(key));
                    active = null;
                    if (isCurrent()) options.onChange?.();
                    if (pending.size) schedule();
                }
            })();
            return active;
        }
        return { read, flush, invalidate, dispose: invalidate };
    }
    root.AgMetricQueueInventory = Object.freeze({ normalizeItem, normalizeLocation, identity, matches, createIndex, createHydrator });
})(typeof window !== 'undefined' ? window : globalThis);
