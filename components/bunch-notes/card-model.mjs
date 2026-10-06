const text = value => String(value ?? '').trim();
const normalized = value => text(value).replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
const field = (row, ...keys) => {
  for (const key of keys) if (row?.[key] !== undefined && row?.[key] !== null) return row[key];
  return '';
};

export const rowLocation = row => text(field(row, 'location_code', 'LOCATIONCODE', 'locationcode', 'LOCATION', 'location'));
export const rowItemCode = row => text(field(row, 'itemcode', 'ITEMCODE', 'item_code'));
export const rowCommonName = row => text(field(row, 'commonname', 'COMMONNAME', 'description', 'DESCRIPTION', 'PLANT_NAME'));
export const rowContainerSize = row => text(field(row, 'contsize', 'CONTSIZE', 'ITEMSPEC', 'SIZE'));
export const rowIdentity = row => text(field(row, 'unique_id', 'UNIQUE_ID', 'id', 'ID'));

export function cardGroupKey(row) {
  return [rowLocation(row), rowItemCode(row), rowCommonName(row), rowContainerSize(row)].map(normalized).join('\u001f');
}

function parseQuantity(value) {
  if (value === null || value === undefined || text(value) === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function total(rows, keys) {
  let sum = 0, known = 0;
  for (const row of rows) {
    let value = null;
    for (const key of keys) {
      value = parseQuantity(row?.[key]);
      if (value !== null) break;
    }
    if (value === null) continue;
    sum += value;
    known += 1;
  }
  return { value: sum, complete: known === rows.length, knownCount: known, rowCount: rows.length };
}
function uniqueRows(rows = []) {
  const result = new Map();
  for (const row of rows) {
    const id = rowIdentity(row);
    if (id && !result.has(id)) result.set(id, row);
  }
  return [...result.values()];
}

function stableCardId(key) {
  const hashes = [2166136261, 2246822519, 3266489917, 668265263];
  for (let index = 0; index < key.length; index += 1) {
    const code = key.charCodeAt(index);
    for (let lane = 0; lane < hashes.length; lane += 1) {
      hashes[lane] = Math.imul(hashes[lane] ^ (code + lane * 131), 16777619 + lane * 2) >>> 0;
    }
  }
  const hex = hashes.map(value => value.toString(16).padStart(8, '0')).join('').split('');
  hex[12] = '5'; hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const id = hex.join('');
  return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`;
}

export function normalizeCardDraft(location, rows = []) {
  const explicit = Array.isArray(location?.cards) ? location.cards : [];
  const legacy = Array.isArray(location?.actions) ? location.actions
    .filter(action => action?.scope === 'rows' && Array.isArray(action.row_ids) && action.row_ids.length)
    .map(action => ({ id: action.id, kind: 'shared', location_code: location.location_code ?? location.location,
      itemcode: action.itemcode ?? '', commonname: action.item_desc ?? '', contsize: action.item_size ?? '',
      row_ids: [...action.row_ids], owner_id: action.owner_id ?? null, house: action.house ?? '',
      direction: action.direction ?? '', action })) : [];
  const cards = explicit.length ? explicit : legacy;
  const allRows = new Map(uniqueRows(rows).map(row => [rowIdentity(row), row]));
  return cards.map(card => {
    const rowIds = [...new Set((card.row_ids || []).map(text).filter(Boolean))];
    const includedRows = rowIds.map(id => allRows.get(id)).filter(Boolean);
    return { ...card, kind: card.kind === 'shared' ? 'shared' : 'inventory', row_ids: rowIds,
      rows: includedRows, row_coverage_complete: includedRows.length === rowIds.length,
      on_hand: total(includedRows, ['stock', 'STOCK', 'onhand', 'ONHAND', 'ptronhand', 'PTRONHAND']),
      available: total(includedRows, ['available', 'AVAILABLE', 'ptravailable', 'PTRAVAILABLE']) };
  });
}

export function groupIncludedRows(cards) {
  const groups = new Map();
  for (const card of cards) {
    for (const row of card.rows) {
      const uid = rowIdentity(row);
      if (!uid) continue;
      const key = cardGroupKey(row);
      let group = groups.get(key);
      if (!group) {
        group = { key, location_code: rowLocation(row), itemcode: rowItemCode(row),
          commonname: rowCommonName(row), contsize: rowContainerSize(row), cards: [], rows: [], _uids: new Set() };
        groups.set(key, group);
      }
      if (!group.cards.some(item => item.id === card.id)) group.cards.push(card);
      if (!group._uids.has(uid)) { group._uids.add(uid); group.rows.push(row); }
    }
  }
  return [...groups.values()].map(group => {
    const { _uids, ...visible } = group;
    visible.rows.sort((a, b) => rowIdentity(a).localeCompare(rowIdentity(b), undefined, { numeric: true }));
    visible.on_hand = total(visible.rows, ['stock', 'STOCK', 'onhand', 'ONHAND', 'ptronhand', 'PTRONHAND']);
    visible.available = total(visible.rows, ['available', 'AVAILABLE', 'ptravailable', 'PTRAVAILABLE']);
    visible.row_ids = visible.rows.map(rowIdentity);
    visible.cards.sort((a, b) => text(a.id).localeCompare(text(b.id)));
    return visible;
  }).sort((a, b) => a.location_code.localeCompare(b.location_code, undefined, { numeric: true })
    || a.commonname.localeCompare(b.commonname, undefined, { sensitivity: 'base' })
    || a.itemcode.localeCompare(b.itemcode, undefined, { sensitivity: 'base' })
    || a.contsize.localeCompare(b.contsize, undefined, { numeric: true, sensitivity: 'base' }));
}

export function buildLocationCardBoard(locations = [], rows = []) {
  const allRows = uniqueRows(rows);
  const locationMap = new Map();
  for (const location of locations) {
    const code = text(location.location_code ?? location.location), key = normalized(code);
    if (!key) continue;
    const existing = locationMap.get(key);
    if (existing) existing.cards = [...(existing.cards || []), ...(location.cards || [])];
    else locationMap.set(key, location);
  }
  for (const row of allRows) {
    const code = rowLocation(row), key = normalized(code);
    if (key && !locationMap.has(key)) locationMap.set(key, { id: `inventory-location:${key}`,
      location: code, location_code: code, cards: [], house_sections: [], direction: '',
      target_houses: '', general_instructions: '', _view_only: true });
  }
  return [...locationMap.values()].map(location => {
    const locationCode = normalized(location.location_code ?? location.location);
    const locationRows = locationCode ? allRows.filter(row => normalized(rowLocation(row)) === locationCode) : allRows;
    const groups = groupIncludedRows([{ id: '__all_rows__', kind: 'inventory', row_ids: locationRows.map(rowIdentity), rows: locationRows }]);
    const savedCards = normalizeCardDraft(location, allRows).filter(card => card.kind === 'inventory');
    const matchedCardIds = new Set();
    const cards = groups.flatMap(group => {
      const matching = savedCards.filter(card => cardGroupKey(card) === group.key);
      if (!matching.length) return [{ id: stableCardId(`${location.location_code ?? location.location}\u001e${group.key}`), view_key: group.key, kind: 'inventory', included: false,
        location_code: group.location_code, itemcode: group.itemcode, commonname: group.commonname,
        contsize: group.contsize, row_ids: group.row_ids, rows: group.rows, row_coverage_complete: true,
        on_hand: group.on_hand, available: group.available }];
      return matching.map(card => {
        matchedCardIds.add(card.id);
        const selectedRows = card.row_ids.map(id => allRows.find(row => rowIdentity(row) === id)).filter(Boolean);
        const coherentRows = selectedRows.filter(row => cardGroupKey(row) === group.key);
        const coverage = card.row_ids.length === coherentRows.length && card.row_ids.length === group.row_ids.length;
        const visibleRows = uniqueRows([...group.rows, ...selectedRows]);
        const onHand = total(visibleRows, ['stock', 'STOCK', 'ptronhand', 'PTRONHAND', 'onhand', 'ONHAND']);
        const available = total(visibleRows, ['available', 'AVAILABLE', 'ptravailable', 'PTRAVAILABLE']);
        return { ...card, view_key: group.key, id: card.id, included: true, rows: visibleRows,
          location_code: card.location_code || group.location_code, itemcode: card.itemcode || group.itemcode,
          commonname: card.commonname || group.commonname, contsize: card.contsize || group.contsize,
          on_hand: coverage ? onHand : { ...onHand, complete: false },
          available: coverage ? available : { ...available, complete: false }, row_coverage_complete: coverage,
          changed_source_ids: selectedRows.filter(row => cardGroupKey(row) !== group.key).map(rowIdentity) };
      });
    });
    const orphanCards = savedCards.filter(card => !matchedCardIds.has(card.id)).map(card => {
      const selectedRows = card.row_ids.map(id => allRows.find(row => rowIdentity(row) === id)).filter(Boolean);
      const onHand = total(selectedRows, ['stock', 'STOCK', 'ptronhand', 'PTRONHAND', 'onhand', 'ONHAND']);
      const available = total(selectedRows, ['available', 'AVAILABLE', 'ptravailable', 'PTRAVAILABLE']);
      return { ...card, view_key: `orphan:${card.id}`, included: true, orphan: true, rows: selectedRows,
        row_coverage_complete: false, on_hand: { ...onHand, complete: false, rowCount: card.row_ids.length },
        available: { ...available, complete: false, rowCount: card.row_ids.length } };
    });
    const displayGroups = groups.map(group => ({ ...group,
      cards: cards.filter(card => !card.orphan && card.view_key === group.key) }));
    if (orphanCards.length) {
      const orphanGroups = new Map();
      for (const card of orphanCards) {
        const key = cardGroupKey(card) || `orphan:${card.id}`;
        if (!orphanGroups.has(key)) orphanGroups.set(key, { key: `orphan:${key}`, orphan: true,
          location_code: card.location_code || text(location.location_code ?? location.location),
          itemcode: card.itemcode || '', commonname: card.commonname || 'Saved card needs review',
          contsize: card.contsize || '', rows: card.rows, row_ids: card.row_ids, cards: [],
          on_hand: card.on_hand, available: card.available });
        orphanGroups.get(key).cards.push(card);
      }
      displayGroups.push(...orphanGroups.values());
    }
    displayGroups.sort((a, b) => a.location_code.localeCompare(b.location_code, undefined, { numeric: true })
      || a.commonname.localeCompare(b.commonname, undefined, { sensitivity: 'base' })
      || a.itemcode.localeCompare(b.itemcode, undefined, { sensitivity: 'base' })
      || a.contsize.localeCompare(b.contsize, undefined, { numeric: true, sensitivity: 'base' }));
    return { location, cards: [...cards, ...orphanCards], groups: displayGroups };
  }).sort((a, b) => text(a.location.location_code ?? a.location.location)
    .localeCompare(text(b.location.location_code ?? b.location.location), undefined, { numeric: true, sensitivity: 'base' }));
}
