export function avBucketFixtureRows() {
  return [
    { UNIQUE_ID: 'b', COMMONNAME: 'Plant 10', GENUSNAME: 'Quercus', CONTSIZE: '#2', LOCATIONCODE: 'A.2', SEASON: 'S1', inWindow: true, bucketMatch: true, S_LTS: '4' },
    { UNIQUE_ID: 'a', COMMONNAME: 'Plant 2', GENUSNAME: 'Acer', CONTSIZE: '#1', LOCATIONCODE: 'A.1', SEASON: 'S1', inWindow: true, bucketMatch: true, S_LTS: '2' },
    { UNIQUE_ID: 'duplicate', COMMONNAME: 'Plant 3', GENUSNAME: 'Rosa', CONTSIZE: '#1', LOCATIONCODE: 'A.3', SEASON: 'S1', inWindow: true, bucketMatch: true, locationKey: 'same-location', S_LTS: '1' },
    { UNIQUE_ID: 'duplicate-loser', COMMONNAME: 'Plant 4', GENUSNAME: 'Prunus', CONTSIZE: '#1', LOCATIONCODE: 'A.4', SEASON: 'S1', inWindow: true, bucketMatch: true, locationKey: 'same-location', S_LTS: '1' },
    { UNIQUE_ID: 'outside-window', COMMONNAME: 'Outside', SEASON: 'S1', inWindow: false, bucketMatch: true, S_LTS: '1' },
    { UNIQUE_ID: 'invalid-approval', COMMONNAME: 'Approval', SEASON: 'S1', inWindow: true, bucketMatch: true, approvalHidden: true, S_LTS: '1' },
    { UNIQUE_ID: 'wrong-bucket', COMMONNAME: 'Other', SEASON: 'U1', inWindow: true, bucketMatch: false, S_LTS: '1' },
    { UNIQUE_ID: 'shift', COMMONNAME: 'Shift', SEASON: 'S1', DESIGITEM: 'SHFT', inWindow: true, bucketMatch: true, S_LTS: '1' },
    { UNIQUE_ID: 'wrong-season', COMMONNAME: 'Wrong season', SEASON: 'U3', inWindow: true, bucketMatch: true, S_LTS: '1' },
  ];
}

export function avBucketFixtureContext(rows, queued) {
  return {
    window: { setTimeout: callback => { queued.push(callback); return queued.length; }, clearTimeout() {} },
    Map, Array, Number, String, Promise, Intl,
    activeAvSalesBucket: 'current', activeAvOpenTab: 'name', fullInventory: rows,
    AV_FILTER_SEASON_OPTIONS: ['F1', 'S1', 'U1', 'U2'],
    normalizeAvSalesBucket: bucket => String(bucket), shouldUseRepAvOpenDataset: () => false,
    getAvSalesReserveDemandRows: () => [], buildAvReserveSeasonIndex: () => ({}),
    isAvCustomerSalesBucket: () => false,
    getAvSalesInventorySourceRows: () => rows,
    shouldHideU3InventoryRowForRep: () => false,
    itemMatchesAvOpenSalesWindow: row => row.inWindow !== false,
    getAvSalesSeasonValue: row => String(row.SEASON || ''),
    isShiftDesigItemRow: row => String(row.DESIGITEM || '').includes('SHFT'),
    shouldHideNotOnInventoryApprovalRowFromInventory: row => !!row.approvalHidden,
    getAvReserveRowsForSalesItem: () => [], shouldIncludeMasterItemInAvOpenStock: row => Number(row.S_LTS) > 0,
    itemMatchesAvSalesBucket: row => !!row.bucketMatch,
    getAvReserveLocationUniqueKey: row => row.locationKey || '',
    firstNonEmptyValue: (...values) => values.find(value => value != null && value !== ''),
    getAvSalesItemCode: row => String(row.ITEMCODE || ''), decorateAvSalesReserveRow: row => row,
    buildAvHotPriceIndex: () => new Map(),
    getSearchWordStartsForProfile: (row, profile) => {
      row.preparedSearchProfile = profile;
      row._searchProfileWordStarts = { ...(row._searchProfileWordStarts || {}), [profile]: [String(row.COMMONNAME || '').toLowerCase()] };
      return row._searchProfileWordStarts[profile];
    },
    avPreparedRawTabRows: new WeakMap(), resolvedViewStateEpoch: 7,
    getAvFilterGenusFacetValue: row => String(row.GENUSNAME || '(Blank)').trim() || '(Blank)',
    getAvFilterContSizeFacetValue: row => String(row.CONTSIZE || '-').trim() || '-',
    avItemHasPhotos: row => !!row.hasPhoto,
  };
}

