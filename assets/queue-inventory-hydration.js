(function (root) {
    'use strict';
    const text = value => String(value ?? '').trim().toUpperCase();
    const pick = (row, ...keys) => keys.map(key => row?.[key]).find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? '';
    function normalizeItem(value) {
        const key = text(value);
        if (/^\d{6}\.\d{3}\.\d$/.test(key)) return key.replace(/\./g, '');
        // ERP item codes may arrive as the 8/9-digit compact form of the
        // standard 10-digit code; shorter numeric identifiers are valid and
        // must not be collapsed by padding (for example `001` vs `1`).
        return /^\d{8,9}$/.test(key) ? key.padStart(10, '0') : key;
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
    const itemLocationKey = value => { const i = identity(value); return JSON.stringify([i.itemCode, i.locationCode]); };
    function createIndex(rows = []) {
        const ids = new Map(), keys = new Map(), itemLocations = new Map(), items = new Map();
        const byItemLoc = new Map(), byItem = new Map(), normalizedSearchText = new WeakMap();
        const aggregate = (map, key, row) => {
            const entry = map.get(key) || { rows: [], locOnHand: 0, onHandKnown: false, available: 0 };
            entry.rows.push(row);
            const raw = pick(row, 'PTRONHAND', 'ptronhand');
            const value = raw === '' ? NaN : Number(String(raw).replace(/,/g, ''));
            if (Number.isFinite(value)) { entry.locOnHand += value; entry.onHandKnown = true; }
            const available = Number(String(pick(row, 'PTRAVAILABLE', 'ptravailable', 'AVAILABLE', 'available')).replace(/,/g, ''));
            if (Number.isFinite(available)) entry.available += available;
            map.set(key, entry);
        };
        for (const row of rows) {
            const uid = String(pick(row, 'UNIQUE_ID', 'unique_id')).trim();
            if (!uid || ids.has(uid)) continue;
            ids.set(uid, row);
            const key = locationLotKey(row);
            if (!keys.has(key)) keys.set(key, []);
            keys.get(key).push(row);
            const itemLocation = itemLocationKey(row);
            if (!itemLocations.has(itemLocation)) itemLocations.set(itemLocation, []);
            itemLocations.get(itemLocation).push(row);
            const itemCode = identity(row).itemCode;
            if (!items.has(itemCode)) items.set(itemCode, []);
            items.get(itemCode).push(row);
            aggregate(byItemLoc, itemLocation, row);
            aggregate(byItem, itemCode, row);
            normalizedSearchText.set(row, String([pick(row, 'COMMONNAME', 'commonname'), itemCode,
                pick(row, 'LOCATIONCODE', 'locationcode'), pick(row, 'CONTSIZE', 'contsize'),
                pick(row, 'LOTCODE', 'lotcode'), pick(row, 'SEASON', 'season')].join(' '))
                .toLowerCase().replace(/[.'â€™â„¢Â®]/g, '').replace(/[-\s]+/g, ' ').trim());
        }
        const representative = rows => rows.reduce((best, row) => !best
            || String(pick(row, 'UNIQUE_ID', 'unique_id')) < String(pick(best, 'UNIQUE_ID', 'unique_id')) ? row : best, null);
        return { byItemLocLot: keys, byItemLoc, byItem, normalizedSearchText, resolveDisplay(input) {
            // Docks shows stock evidence from a complete authorized snapshot.
            // This representative is never an exact-row mutation identity.
            const i = identity(input);
            if (!i.itemCode) return { status:'missing', row:null };
            for (const [matchLevel, candidates] of [
                ['item-location-lot', i.locationCode ? keys.get(locationLotKey(i)) : null],
                ['item-location', i.locationCode ? itemLocations.get(itemLocationKey(i)) : null],
                ['item', items.get(i.itemCode)]
            ]) {
                if (candidates?.length) return { status:'ready', row:representative(candidates), matchLevel };
            }
            return { status:'missing', row:null };
        }, resolveSuspendTagDisplay(input, fallbackRows = []) {
            const i = identity(input);
            if (!i.itemCode || !i.locationCode) return { status:'missing', row:null };
            if (/^0+\.0+\.111$/.test(i.locationCode)) return { status:'missing', row:null };
            const exactRows = i.locationCode && i.lotCode
                ? (keys.get(locationLotKey(i)) || []).filter(row => matches(row, i)) : [];
            const sameLocationRows = (itemLocations.get(itemLocationKey(i)) || []).filter(row => !i.source || identity(row).source === i.source);
            if (exactRows.length > 1 && i.source) return { status:'ambiguous', row:null };
            const rowsForMetrics = exactRows.length ? exactRows : sameLocationRows;
            if (!rowsForMetrics.length) return { status:'missing', row:null };
            const base = representative(rowsForMetrics) || {};
            const sum = keys => {
                let total = 0, found = false;
                for (const row of rowsForMetrics) {
                    const value = pick(row, ...keys);
                    if (value === '') continue;
                    const number = Number(String(value).replace(/,/g, ''));
                    if (!Number.isFinite(number)) continue;
                    total += number;
                    found = true;
                }
                return found ? total : null;
            };
            const sumAvailable = rows => {
                let total = 0, found = false;
                for (const row of rows) {
                    const raw = pick(row, 'PTRAVAILABLE', 'ptravailable', 'AVAILABLE', 'available');
                    const available = raw === '' ? NaN : Number(String(raw).replace(/,/g, ''));
                    if (Number.isFinite(available)) {
                        total += available;
                        found = true;
                        continue;
                    }
                    const onHandRaw = pick(row, 'PTRONHAND', 'ptronhand');
                    const reviewedRaw = pick(row, 'PTRREVIEWED', 'ptrreviewed');
                    if (onHandRaw === '' || reviewedRaw === '') continue;
                    const onHand = Number(String(onHandRaw).replace(/,/g, ''));
                    const reviewed = Number(String(reviewedRaw).replace(/,/g, ''));
                    if (!Number.isFinite(onHand) || !Number.isFinite(reviewed)) continue;
                    total += onHand - reviewed;
                    found = true;
                }
                return found ? total : null;
            };
            const openStockBySeason = new Map();
            for (const row of rowsForMetrics) {
                const value = pick(row, 'S_LTS', 's_lts');
                if (value === '') continue;
                const season = text(pick(row, 'SEASON', 'season'));
                const key = season || `${identity(row).lotCode}|${value}`;
                if (!openStockBySeason.has(key)) {
                    const number = Number(String(value).replace(/,/g, ''));
                    if (Number.isFinite(number)) openStockBySeason.set(key, number);
                }
            }
            const locationRows = itemLocations.get(itemLocationKey(i)) || [];
            let locationOnHandFound = false;
            const locationOnHand = locationRows.reduce((total, row) => {
                const value = pick(row, 'PTRONHAND', 'ptronhand');
                if (value === '') return total;
                const number = Number(String(value || '0').replace(/,/g, ''));
                if (Number.isFinite(number)) locationOnHandFound = true;
                return total + (Number.isFinite(number) ? number : 0);
            }, 0);
            let locationPhotoMatchFound = false;
            const locationPhotoMatch = rowsForMetrics.reduce((total, row) => {
                const value = pick(row, 'LOC_MATCH_QTY', 'loc_match_qty');
                if (value === '') return total;
                const number = Number(String(value).replace(/,/g, ''));
                if (!Number.isFinite(number)) return total;
                locationPhotoMatchFound = true;
                return total + number;
            }, 0);
            return { status:'ready', matchLevel: exactRows.length ? 'item-location-lot' : 'item-location', row:{
                ...base,
                PTRONHAND: sum(['PTRONHAND', 'ptronhand']),
                PTRREVIEWED: sum(['PTRREVIEWED', 'ptrreviewed']) ?? (sum(['PTRONHAND', 'ptronhand']) !== null ? 0 : null),
                PTRAVAILABLE: sumAvailable(rowsForMetrics),
                S_LTS: openStockBySeason.size ? [...openStockBySeason.values()].reduce((total, value) => total + value, 0) : null,
                LOC_ON_HAND: locationRows.length ? (locationOnHandFound ? locationOnHand : null) : 0,
                LOC_PHOTO_MATCH: Object.prototype.hasOwnProperty.call(base, 'LOC_PHOTO_MATCH') ? base.LOC_PHOTO_MATCH
                    : Object.prototype.hasOwnProperty.call(base, 'loc_photo_match') ? base.loc_photo_match : null,
                LOC_MATCH_QTY: rowsForMetrics.length ? (locationPhotoMatchFound ? locationPhotoMatch : null) : null
            } };
        }, resolve(input) {
            const i = identity(input);
            if (i.masterUid) {
                const row = ids.get(i.masterUid);
                return row && matches(row, i) ? { status:'ready', row } : { status:'missing', row:null };
            }
            const candidates = keys.get(locationLotKey(i)) || [];
            const exact = candidates.filter(row => matches(row, i));
            if (exact.length) return { status: exact.length === 1 ? 'ready' : 'ambiguous', row: exact.length === 1 ? exact[0] : null };
            // This index is used only to display a verified snapshot on queue
            // cards. When the source omits or changes lot/source qualifiers,
            // allow a unique normalized item+location match; never pick one of
            // multiple physical master rows at that location.
            const scoped = !i.lotCode && i.itemCode && i.locationCode ? itemLocations.get(itemLocationKey(i)) || [] : [];
            return { status: scoped.length === 1 ? 'ready' : scoped.length ? 'ambiguous' : 'missing', row: scoped.length === 1 ? scoped[0] : null };
        } };
    }
    function createHydrator(options) {
        let entries = new Map(), pending = new Map(), active = null, timer = null, generation = 0, scope = '', navigationSignal = null;
        const inflight = new Set();
        const contextKey = c => c ? JSON.stringify([c.scope, c.permission, String(c.revision || '')]) : '';
        const current = () => {
            const c = options.context();
            const usable = c && c.scope && c.permission && !c.signal?.aborted;
            const next = usable ? contextKey(c) : '';
            const nextSignal = usable ? c.signal || null : null;
            if (scope !== next || navigationSignal !== nextSignal) {
                invalidate();
                scope = next;
                navigationSignal = nextSignal;
            }
            return usable ? c : null;
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
