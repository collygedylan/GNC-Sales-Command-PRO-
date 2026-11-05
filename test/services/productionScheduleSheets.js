const TITLE_FIELDS = {
  'PROD SCHED': ['VAR', 'GENUS', 'ITEM NO.'],
  'PltDate-PltGrp': ['ACTIVE LINK 2027 Plant Group Code', 'Plant Group Code'],
  ContTable: ['Description', 'Printed Size', 'Code'],
  'Code Key': ['Description', 'Code'],
  Calculations: ['Description', 'Vendor ID'],
  "New Weighted%'s": ['Common Name', 'Item Number'],
  CPB: ['Description', 'Size'],
};

const COMPACT_FIELDS = {
  'PROD SCHED': ['ITEM NO.', 'Plt.Loc.', 'LOT', '2027 SCH TOTAL', '2027 Bed Space'],
  'PltDate-PltGrp': ['2027 Target Plant Date', 'Spring / Fall', 'Source LD / Shift /Purchase'],
  ContTable: ['Code', 'Printed Size', 'Stat', 'Cont Class'],
  'Code Key': ['Code', 'Plant Group Codes'],
  Calculations: ['Vendor ID', 'Size', 'Program', 'Type'],
  "New Weighted%'s": ['Item Number', 'Grand Total', 'Check'],
  CPB: ['CPB', 'Count'],
};

export function normalizeProductionScheduleHeader(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function columnName(index) {
  let number = Number(index);
  if (!Number.isInteger(number) || number < 1) return String(index);
  let label = '';
  while (number > 0) {
    number -= 1;
    label = String.fromCharCode(65 + number % 26) + label;
    number = Math.floor(number / 26);
  }
  return label;
}

export function getScheduleCell(row, column) {
  const cells = row?.cells;
  if (!cells || typeof cells !== 'object') return '';
  return String(cells[String(column)] ?? '');
}

export function findScheduleColumn(sheet, names) {
  const columns = Array.isArray(sheet?.columns) ? sheet.columns : [];
  for (const name of names) {
    const expected = normalizeProductionScheduleHeader(name);
    const found = columns.find((column) => normalizeProductionScheduleHeader(column.header) === expected);
    if (found) return found;
  }
  return null;
}

export function getScheduleCardColumnIndexes(sheet) {
  const namedFields = [
    ...(TITLE_FIELDS[sheet?.title] || []),
    ...(COMPACT_FIELDS[sheet?.title] || []),
  ];
  const indexes = [];
  for (const name of namedFields) {
    const column = findScheduleColumn(sheet, [name]);
    if (column && Number.isInteger(Number(column.index)) && Number(column.index) > 0) indexes.push(Number(column.index));
  }
  const columns = Array.isArray(sheet?.columns) ? sheet.columns : [];
  // Keep a small source-order fallback so cards still have a useful title when
  // a sheet has unexpected or blank headers.
  for (const column of columns.slice(0, 4)) {
    if (Number.isInteger(Number(column?.index)) && Number(column.index) > 0) indexes.push(Number(column.index));
  }
  return [...new Set(indexes)].slice(0, 32);
}

function findField(sheet, row, name) {
  const column = findScheduleColumn(sheet, [name]);
  if (!column) return null;
  const value = getScheduleCell(row, column.index).trim();
  return value ? { label: String(column.header || name).replace(/\s+/g, ' ').trim(), value } : null;
}

export function getScheduleCard(sheet, row) {
  const titleNames = TITLE_FIELDS[sheet?.title] || [];
  const columns = Array.isArray(sheet?.columns) ? sheet.columns : [];
  const titleField = titleNames.map((name) => findField(sheet, row, name)).find(Boolean);
  const requestedIndexes = new Set(getScheduleCardColumnIndexes(sheet));
  const firstPopulated = columns.filter((column) => requestedIndexes.has(Number(column.index)))
    .map((column) => ({ column, value: getScheduleCell(row, column.index).trim() }))
    .find((entry) => entry.value);
  const title = titleField?.value || firstPopulated?.value || `Source row ${row?.sourceRow ?? '?'}`;
  const compactNames = COMPACT_FIELDS[sheet?.title] || [];
  const fields = compactNames.map((name) => findField(sheet, row, name)).filter(Boolean)
    .filter((field) => field.value !== title).slice(0, 5);
  if (!fields.length && firstPopulated && firstPopulated.value !== title) {
    fields.push({ label: firstPopulated.column.header || `Column ${columnName(firstPopulated.column.index)}`, value: firstPopulated.value });
  }
  return { title, fields, sourceRow: row?.sourceRow };
}

export function getScheduleRowDetails(sheet, row) {
  const columns = Array.isArray(sheet?.columns) ? sheet.columns : [];
  const named = columns.filter((column) => {
    const value = getScheduleCell(row, column.index);
    return value !== '' && value.trim() !== '';
  }).map((column) => ({
    index: Number(column.index),
    label: String(column.header || '').replace(/\s+/g, ' ').trim() || `Column ${columnName(column.index)}`,
    value: getScheduleCell(row, column.index),
  }));
  const seen = new Set(named.map((entry) => entry.index));
  for (const [key, value] of Object.entries(row?.cells || {})) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 1 || seen.has(index) || String(value).trim() === '') continue;
    named.push({ index, label: `Column ${columnName(index)}`, value: String(value) });
  }
  return named.sort((a, b) => a.index - b.index);
}
