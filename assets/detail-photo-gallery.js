function renderSavedPhotos() {
    let sLink = getSharedAppPhotoLinkCsv(activeItem) || "";
    let rLink = getRequestPhotoLinkCsv(activeItem) || "";
    let dLink = getDockOwnedPhotoLinkCsv(activeItem) || "";
    let fLink = getFlyerVisiblePhotoLinkCsv(activeItem) || "";
    renderSavedPhotoGallery(sLink, 'ssn-photo-list-container', 'ssn-photo-preview', 'ssn-', 'Base Photos');
    renderSavedPhotoGallery(sLink, 'lsn-photo-list-container', 'lsn-photo-preview', 'lsn-', 'Base Photos');
    renderSavedPhotoGallery(sLink, 'na-photo-list-container', 'na-photo-preview', 'na-', 'Base Photos');
    renderSavedPhotoGallery(rLink, 'req-photo-list-container', 'req-photo-preview', 'req-', 'Request Photos');
    renderSavedPhotoGallery(dLink, 'dock-photo-list-container', 'dock-photo-preview', 'dock-', 'Dock Photos');
    renderSavedPhotoGallery(fLink, 'flyer-photo-list-container', 'flyer-photo-preview', 'flyer-', 'Flyer Photos');
    renderNcrDraftPhotos(activeItem);
    refreshProtectedSections();
}
function renderSavedPhotoGallery(link, containerId, wrapperId, prefix, title) {
    let el = document.getElementById(containerId);
    let wrap = document.getElementById(wrapperId);
    if (!el || !wrap)
        return;
    const entries = getDisplayPhotoEntries(prefix, activeItem, link);
    if (prefix !== 'flyer-') {
        const owned = new Set(entries.flatMap(entry => getPhotoUrlList(entry.url)));
        const display = prefix === 'req-' ? getQueueDisplayEvidenceRow(activeItem) || activeItem : activeItem;
        const urls = prefix === 'req-' && activeDetailSourceView === 'request' ? getQueueDisplayPhotoUrls(display) : getInventoryLocationPhotos(display);
        for (const url of urls)
            if (!owned.has(url))
                entries.push({ url, shared: true, persistedIndex: -1, dateLabel: resolveAndFormatPhotoDate(activeItem, url) });
    }
    if (entries.length > 0) {
        const allowReorder = canReorderProtectedPhoto(prefix);
        const persistedEntries = entries.filter((entry) => !entry.pending && entry.persistedIndex > -1);
        const openLink = entries.map((entry) => entry.url).join(',');
        let html = `<div class="flex gap-2 overflow-x-auto pb-2">`;
        html += entries.map((entry, photoIndex) => renderSavedPhotoGalleryTile(entry, photoIndex, { prefix, entries, persistedEntries, openLink, title, allowReorder })).join('');
        html += `</div>`;
        const mediaSignature = getCompletedRowUnlockKey(activeItem) + ':' + JSON.stringify(entries.map(entry => [entry.url, entry.previewUrl, entry.status, entry.dateLabel, entry.persistedIndex])) + ':' + canRemoveProtectedPhoto(prefix) + ':' + allowReorder;
        if (el.dataset.mediaSignature !== mediaSignature) {
            replaceDetailMediaPreservingImages(el, html);
            el.dataset.mediaSignature = mediaSignature;
        }
        scheduleDeferredCardPhotoHydration(el);
        wrap.classList.remove('hidden');
    }
    else {
        el.innerHTML = "";
        delete el.dataset.mediaSignature;
        wrap.classList.add('hidden');
    }
}
function renderSavedPhotoGalleryTile(entry, photoIndex, { prefix, entries, persistedEntries, openLink, title, allowReorder }) {
    const cleanUrl = getPhotoUrlList(entry.url)[0] || '';
    if (!cleanUrl)
        return '';
    const thumb = entry.previewUrl || getDirectImageUrl(cleanUrl, 'gallery-tile');
    const canRemoveThis = canRemoveProtectedPhoto(prefix, activeItem) && !entry.pending && (entry.persistedIndex > -1 || entry.publicUrl);
    const cleanUrlAttr = escJsAttrValue(cleanUrl);
    const pressAttrs = canRemoveThis ? ` oncontextmenu="event.preventDefault(); return false;" onmousedown="startPhotoDeletePress(event, '${prefix}', ${entry.persistedIndex}, '${cleanUrlAttr}')" onmouseup="cancelPhotoDeletePress('${prefix}', ${entry.persistedIndex})" onmouseleave="cancelPhotoDeletePress('${prefix}', ${entry.persistedIndex})" ontouchstart="startPhotoDeletePress(event, '${prefix}', ${entry.persistedIndex}, '${cleanUrlAttr}')" ontouchend="cancelPhotoDeletePress('${prefix}', ${entry.persistedIndex})" ontouchcancel="cancelPhotoDeletePress('${prefix}', ${entry.persistedIndex})" ontouchmove="cancelPhotoDeletePress('${prefix}', ${entry.persistedIndex})"` : '';
    const deleteButtonHtml = canRemoveThis
        ? `<button type="button" class="absolute -right-1 -top-1 z-10 inline-flex h-7 min-w-[28px] items-center justify-center gap-1 rounded-full border border-white bg-red-600 px-1.5 text-[8px] font-black uppercase tracking-[0.08em] text-white shadow-md active:scale-95" onclick="event.stopPropagation(); return promptPhotoDelete('${prefix}', ${entry.persistedIndex}, '${cleanUrlAttr}')" aria-label="Delete photo"><i class="ph-bold ph-trash"></i><span class="hidden sm:inline">Delete</span></button>`
        : '';
    const statusHtml = entry.pending ? `<div class="mt-1 text-[9px] font-bold text-emerald-500 uppercase text-center">${escapeHtml(entry.status || 'Uploading')}</div>${entry.uploadId && entry.status === 'Save failed' ? `<button type="button" class="mt-1 border rounded px-2 py-1" onclick="retryDrivePhotoAttachment('${escJsAttrValue(entry.uploadId)}')">Retry photo</button><button type="button" class="mt-1 border rounded px-2 py-1" onclick="event.stopPropagation(); discardDrivePhotoAttachment('${escJsAttrValue(entry.uploadId)}')">Tap Delete</button>` : ''}` : '<div class="photo-uploaded-status mt-1 text-[9px] font-bold text-emerald-600 uppercase text-center">✓ SAVED</div>';
    const dateHtml = entry.dateLabel ? `<div class="mt-1 text-[9px] font-bold text-slate-400 uppercase text-center">Photo ${entry.dateLabel}</div>` : '';
    const firstVisiblePersistedIndex = persistedEntries.length ? persistedEntries[0].persistedIndex : -1;
    const lastVisiblePersistedIndex = persistedEntries.length ? persistedEntries[persistedEntries.length - 1].persistedIndex : -1;
    const reorderHtml = allowReorder && !entry.shared && !entry.pending && persistedEntries.length > 1 ? `<div class="photo-reorder-pair mt-1 flex items-center justify-center gap-1"><button type="button" class="px-2 py-1 text-[10px] font-black rounded-md border border-emerald-600 bg-emerald-950 text-emerald-100 ${entry.persistedIndex === firstVisiblePersistedIndex ? 'opacity-30 pointer-events-none' : ''}" onclick="event.stopPropagation(); movePhotoInSet('${prefix}', ${entry.persistedIndex}, -1)">LEFT</button><button type="button" class="px-2 py-1 text-[10px] font-black rounded-md border border-emerald-600 bg-emerald-950 text-emerald-100 ${entry.persistedIndex === lastVisiblePersistedIndex ? 'opacity-30 pointer-events-none' : ''}" onclick="event.stopPropagation(); movePhotoInSet('${prefix}', ${entry.persistedIndex}, 1)">RIGHT</button></div>` : '';
    return `<div class="saved-photo-tile relative shrink-0">${deleteButtonHtml}<button type="button" class="p-0 border-0 bg-transparent" onclick="handlePhotoThumbClick('${openLink}', '${title}', ${photoIndex})"${pressAttrs}>${buildDeferredCardPhotoImg(thumb, { hydrateNow: true, loading: 'eager', className: 'w-20 h-20 object-cover rounded-lg border border-gray-300 cursor-pointer shadow-sm active:scale-95' }).replace('<img ', '<img data-photo-url="' + escapeHtml(cleanUrl) + '" data-local-preview-url="' + escapeHtml(entry.localPreviewUrl || entry.previewUrl || '') + '" ')}</button><div class="photo-count text-center text-[9px]">${photoIndex + 1}/${entries.length}</div>${statusHtml}${dateHtml}${reorderHtml}</div>`;
}
