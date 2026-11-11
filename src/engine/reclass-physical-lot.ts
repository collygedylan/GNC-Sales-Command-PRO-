/** A bare Season Y lot gets its destination prefix from its physical inventory row. */
export function reclassDestinationLot(row: Record<string, unknown>, destinationSeason: string): string {
    const lot = String(row.lotcode ?? row.LOTCODE ?? '').trim().toUpperCase();
    let stem = lot.replace(/[.][^.]+$/, '');
    if (lot === 'Y') {
        const year = String(row.saleyear ?? row.SALEYEAR ?? '').trim();
        const season = String(row.season ?? row.SEASON ?? '').trim().toUpperCase();
        if (season !== 'Y' || !/^(?:20)?[0-9]{2}$/.test(year)) throw new Error('INVENTORY_RECLASS_LOT_INVALID');
        stem = year.slice(-2);
    }
    return stem + '.' + destinationSeason;
}
