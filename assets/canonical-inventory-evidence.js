function collectCanonicalInventoryPhotos(target, ranked, depleted, dependencies) {
    const { val, getPhotoUrlList, getPhotoEntryDateMs } = dependencies;
    const photos = new Map();
    for (const source of [target, ...(depleted ? [] : ranked)]) {
        const raw = [source.PHOTOS, source.photos].flatMap(parseCanonicalPhotoMetadata);
        const urls = ['PHOTO_LINK', 'SAVED_PHOTO_LINK', 'PHOTOS', 'PHOTO_URL'].flatMap(key => getPhotoUrlList(val(source, key)));
        for (const url of urls) {
            const stamp = getPhotoEntryDateMs(url, source);
            if (source !== target && (!Number.isFinite(stamp) || stamp > Date.now() || Date.now() - stamp > 10 * 86400000)) continue;
            if (photos.has(url)) continue;
            const metadata = raw.find(entry => entry && typeof entry === 'object' && getPhotoUrlList([entry]).includes(url));
            photos.set(url, canonicalPhotoMetadataValue(metadata, url, stamp));
        }
    }
    return photos;
}

function canonicalPhotoMetadataValue(metadata, url, stamp) {
    if (metadata) return { ...metadata };
    return Number.isFinite(stamp) ? { url, date: new Date(stamp).toISOString() } : url;
}

function parseCanonicalPhotoMetadata(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim().startsWith('[')) return [];
    try { return JSON.parse(value); } catch { return []; }
}

function applyCanonicalInventoryPhotos(result, photos, dependencies) {
    if (!photos.size) return;
    const { val, getPhotoRetentionFallbackDateMs } = dependencies;
    result.PHOTO_LINK = result.photo_link = result.SAVED_PHOTO_LINK = [...photos.keys()].join(',');
    result.PHOTOS = result.photos = [...photos.values()];
    result.PHOTO_URL = result.photo_url = [...photos.keys()][0];
    const stamp = getPhotoRetentionFallbackDateMs(result);
    if (!String(val(result, 'PHOTO_DATE')).trim() && Number.isFinite(stamp)) result.PHOTO_DATE = result.photo_date = new Date(stamp).toISOString();
}

function applyCanonicalInventoryMetricAliases(row, target, result, quantity) {
    const metricFamilies = [["PTRONHAND", "PTR_ON_HAND", "EXT_PTRONHAND", "ON_HAND", "ONHAND", "onHand", "qty_on_hand", "oh"], ["PTRREVIEWED", "PTR_REVIEWED", "PTRREVIEW", "REVIEWED", "REVIEW", "REVIEW_QTY"], ["PTRAVAILABLE", "PRTAVAILABLE", "AVAILABLE", "AVAILABLE_QTY", "LOC_AVAIL", "LOC_AVAILABLE", "LOCAVA"], ["S_LTS", "OPEN_STOCK", "openStock"], ["LOC_ON_HAND", "locOnHand"], ["LOC_PHOTO_MATCH", "LOC_MATCH_QTY", "CURRENT_PHOTO_MATCH_QTY", "REQ_LOC_MATCH_QTY", "PHOTO_MATCH_QTY", "locPhotoMatch"]];
    const snapshot = row.SNAPSHOT || target.SNAPSHOT ? { ...(row.SNAPSHOT || {}), ...(target.SNAPSHOT || {}) } : null;
    for (const keys of metricFamilies) {
        const aliases = [...new Set(keys.flatMap(key => [key, key.toLowerCase()]))];
        const ownKey = aliases.find(key => Object.hasOwn(target, key));
        const value = canonicalMetricFamilyValue(keys, aliases, target, quantity, ownKey);
        applyCanonicalMetricFamily(result, snapshot, aliases, value, keys[0] === 'LOC_ON_HAND' && ownKey !== undefined);
    }
    if (snapshot) result.SNAPSHOT = snapshot;
}

function canonicalMetricFamilyValue(keys, aliases, target, quantity, ownKey) {
    if (keys[0] === 'LOC_PHOTO_MATCH' && quantity !== undefined) return quantity;
    if (ownKey !== undefined) return target[ownKey];
    const snapshotKey = target.SNAPSHOT ? aliases.find(key => Object.hasOwn(target.SNAPSHOT, key)) : undefined;
    return snapshotKey !== undefined ? target.SNAPSHOT[snapshotKey] : undefined;
}

function applyCanonicalMetricFamily(result, snapshot, aliases, value, keepNullLocation) {
    for (const key of aliases) {
        if ((value == null || String(value).trim() === '') && !keepNullLocation) {
            delete result[key];
            if (snapshot) delete snapshot[key];
        } else {
            result[key] = value;
            if (snapshot) snapshot[key] = value;
        }
    }
}
