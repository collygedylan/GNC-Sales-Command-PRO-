export function formatInventoryItemsText(items, headerLabel = 'SELECTED ROWS', options = {}) {
    const header = options.includeHeader !== false && headerLabel ? `${headerLabel}\n\n` : '';
    const omit = new Set((Array.isArray(options.omitFieldLabels) ? options.omitFieldLabels : [])
        .map(label => String(label || '').trim().toLowerCase()));
    const blocks = (items || []).map(item => inventoryShareTextBlock(item, omit, options.includePhotoUrls === true));
    return (header + blocks.join('\n')).trimEnd();
}

function inventoryShareTextBlock(item, omit, includePhotoUrls) {
    const photos = getInventorySharePhotoEntries(item);
    const identity = getInventoryShareGalleryIdentity(item);
    const lines = [`${identity.title}${identity.lotCode ? ` ${identity.lotCode}` : ''}`];
    for (const field of getInventoryShareFieldRows(item)) {
        if (omit.has(String(field.label || '').trim().toLowerCase())) continue;
        const raw = String(firstNonEmptyValue(field.value, '') || '').trim();
        if (!raw && !field.force) continue;
        const value = field.percent && raw && !raw.includes('%') ? `${raw}%` : raw;
        lines.push(`${field.label}: ${value}`);
        if (isCaliperEmailField(field.label) && hasCaliperEmailValue(value)) lines.push(CALIPER_MEASUREMENT_NOTE);
    }
    if (photos.length) lines.push(`Photos: ${photos.length} photo${photos.length === 1 ? '' : 's'}`);
    if (includePhotoUrls) lines.push(...photos.map(photo => `${photo.label}: ${photo.href}`));
    return lines.join('\n') + '\n';
}
