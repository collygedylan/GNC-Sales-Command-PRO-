(function installCompanyDirectoryCache(global) {
  'use strict';
  /** @typedef {Record<string, unknown>} Row */
  /** @typedef {{ contacts: Row[], blocks: Row[], beds: Row[], codes: Row[] }} Snapshot */
  /** @typedef {(table: string, query: string) => Promise<Row[]>} ReadPage */
  const definitions = [
    ['contacts', 'ph_company_directory_contacts', 'name.asc,id.asc'],
    ['blocks', 'ph_company_directory_blocks', 'letter.asc'],
    ['beds', 'ph_company_directory_beds', 'block_letter.asc,bed_identifier.asc,id.asc'],
    ['codes', 'ph_company_directory_codes', 'code.asc,id.asc'],
  ];
  function create() {
    let owner = '', generation = 0;
    let indexes = new WeakMap();
    /** @type {Snapshot | null} */ let snapshot = null;
    /** @type {Promise<Snapshot> | null} */ let pending = null;
    function clear() { owner = ''; generation++; snapshot = null; pending = null; indexes = new WeakMap(); }
    /** @param {Row[]} rows @param {string} field @param {{ query?: string, filterValue?: string, reviewOnly?: boolean }} options */
    function select(rows, field, options = {}) {
      let fields = indexes.get(rows);
      if (!fields) { fields = new Map(); indexes.set(rows, fields); }
      let index = fields.get(field);
      if (!index) {
        const entries = rows.map(row => ({ row, filter: String(row[field] || ''), review: row.needs_review === true,
          values: Object.values(row).map(value => String(value ?? '').toLowerCase()) }));
        const filterOptions = [...new Set(entries.map(entry => entry.filter.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        index = { entries, filterOptions, key: null, result: null }; fields.set(field, index);
      }
      const query = String(options.query || '').trim().toLowerCase(), filter = options.filterValue || '', review = options.reviewOnly === true;
      const key = JSON.stringify([query, filter, review]);
      if (key !== index.key) {
        index.result = { filterOptions: index.filterOptions, rows: !query && !filter && !review ? rows : index.entries
          .filter(entry => (!review || entry.review) && (!filter || entry.filter === filter) && (!query || entry.values.some(value => value.includes(query))))
          .map(entry => entry.row) };
        index.key = key;
      }
      return index.result;
    }
    /** @param {string} key */
    function peek(key) { return key && key === owner ? snapshot : null; }
    /** @param {string} key @param {ReadPage} read @returns {Promise<Snapshot>} */
    function refresh(key, read) {
      if (!key) return Promise.reject(new Error('Directory identity is required.'));
      if (key !== owner) { clear(); owner = key; }
      if (pending) return pending;
      const version = generation;
      // The injected Supabase transport already walks bounded 1,000-row pages.
      // Adding another offset/limit loop would duplicate query parameters.
      const promise = Promise.all(definitions.map(async ([field, table, order]) => {
        const rows = await read(table, `select=*&order=${order}`);
        if (!Array.isArray(rows)) throw new Error('Directory returned an invalid snapshot.');
        return [field, rows];
      }))
        .then(entries => {
          const next = /** @type {Snapshot} */ (Object.fromEntries(entries));
          if (version === generation && owner === key) snapshot = next;
          return next;
        }).catch(error => {
          if (version === generation && owner === key && ([401, 403].includes(Number(error?.status)) || error?.code === '42501')) snapshot = null;
          throw error;
        }).finally(() => { if (pending === promise) pending = null; });
      pending = promise;
      return promise;
    }
    return Object.freeze({ peek, refresh, clear, select });
  }
  Object.defineProperty(global, 'GncCompanyDirectoryCache', { configurable: true, value: Object.freeze({ create }) });
})(window);
