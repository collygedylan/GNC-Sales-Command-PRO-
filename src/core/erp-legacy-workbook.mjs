function findHeader(rows, dataset, normalize) {
  return rows.findIndex(row => {
    const names = row.map(normalize);
    return names.includes('itemcode') || (dataset === 'cav' && names.includes('item')
      && ['productdescription', 'brandcode', 'size', 'season', 'available'].every(name => names.includes(name)));
  });
}

export async function parseLegacyErpPage(bytes, start, limit, checkpoint, api) {
  const XLSX = await api.loadWorkbook();
  const book = XLSX.read(bytes, { type: 'array', cellDates: false, sheetRows: api.maxRows + 2 });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) throw new Error('ERP_SOURCE_EMPTY');
  const records = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: true });
  const headerIndex = Number.isSafeInteger(checkpoint.headerRowIndex)
    ? checkpoint.headerRowIndex : findHeader(records, checkpoint.dataset, api.normalizeHeader);
  if (headerIndex < 0) throw new Error('ERP_SOURCE_HEADER_MISSING');
  const header = checkpoint.header || records[headerIndex];
  const offset = Math.max(0, Number(start) || 0);
  const pageSize = Math.max(1, Number(limit) || 1);
  const page = records.slice(headerIndex + 1 + offset, headerIndex + 1 + offset + pageSize);
  const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref'] || 'A1');
  const totalRows = Math.max(0, range.e.r - headerIndex);
  if (totalRows > api.maxRows) throw new Error('ERP_ROWS_INVALID');
  const rows = api.toObjects([header, ...page], true, checkpoint.dataset);
  if (!rows.length && offset === 0) throw new Error('ERP_SOURCE_EMPTY');
  const nextOffset = offset + page.length;
  return { rows, nextOffset, done: nextOffset >= totalRows, totalRows,
    headerRowIndex: headerIndex, header };
}
