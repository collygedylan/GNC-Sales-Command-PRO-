
function syncInlineItemDetailShare(root) {
            if (!root) return;
            if (isCompactQueueDetail(activeItem, activeDetailSourceView || lastView)) {
                root.querySelector('[data-inline-detail-share]')?.remove();
                return;
            }
            if (root.querySelector('[data-inline-detail-share]')) return;
            const button = document.createElement('button');
            button.type = 'button'; button.dataset.inlineDetailShare = 'true';
            button.className = 'rounded-xl bg-[#113221] text-white px-4 py-3 font-bold';
            button.textContent = '📋 Share / Copy';
            button.onclick = async () => {
                if (!activeItem) return;
                const request = isRequestOwnedPhotoRow(activeItem);
                await copyTextWithFallback(request ? formatRequestItemsText([activeItem]) : formatInventoryItemsText([activeItem]), request ? formatRequestItemsHtml([activeItem]) : formatInventoryItemsHtml([activeItem]));
                showToast('Copied', 'Card and all photos copied.');
            };
            root.prepend(button);
        }

function collectStrictItemDetailPhotos(targetRow = null, prefix = '') {
    if (!targetRow) return [];
    const state = getManagerAssignedColumnState();
    const master = findLinkedMasterRow(targetRow) || masterInventoryById.get(String(targetRow.UNIQUE_ID || targetRow.unique_id || ''));
    const masterUid = String(master?.UNIQUE_ID || master?.unique_id || targetRow.MASTER_ID || targetRow.master_id || targetRow.MASTER_UNIQUE_ID || targetRow.master_unique_id || '');
    const rowUid = row => String(row?.MASTER_ID || row?.master_id || row?.MASTER_UNIQUE_ID || row?.master_unique_id || row?.UNIQUE_ID || row?.unique_id || '');
    const matches = row => canonicalInventorySameLot(row,targetRow) && (!masterUid || rowUid(row) === masterUid);
    const urls = new Set(), visited = new Set();
    const add = input => {
        if (!input) return;
        if (Array.isArray(input)) { input.forEach(add); return; }
        if (typeof input === 'object') {
            if (visited.has(input)) return;
            visited.add(input);
            for (const key of ['url','publicUrl','photo_url','photo_urls','photos','request_photos','photo_link','saved_photo_link','req_photo_link','request_photo_link','dock_photo_link','flyer_photo_link']) {
                add(input[key]); add(input[key.toUpperCase()]);
            }
            return;
        }
        getPhotoUrlList(input).forEach(url => {
            const normalized = normalizeStoragePublicUrl(url);
            if (/^https?:\/\//i.test(normalized)) urls.add(normalized);
        });
    };
    add(targetRow);
    getPendingPhotoPreviewEntries(targetRow, prefix).forEach(slot => add(slot.publicUrl));
    const active = typeof activeItem !== 'undefined' && activeItem;
    const activeMatches = active && (active === targetRow || matches(active));
    const evalMatches = prefix === 'eval-' && String(evalWorkActiveOriginUid || '') === String(masterUid || rowUid(targetRow)) && !!getEvalWorkById(activeEvalWorkDetailId);
    if (activeMatches || evalMatches) {
        if (activeMatches) add(active);
        if (evalMatches) add(evalWorkActivePhotos);
        add(state.activeItemDetailPhotos); add(state.itemDetailDraft?.photos);
        const detail = evalMatches ? document.querySelector('#request-content .eval-work-evidence') : document.getElementById('view-detail');
        if (detail && !detail.classList.contains('hidden')) {
            const strip = evalMatches ? detail : document.getElementById(prefix + 'photo-list-container') || detail;
            strip.querySelectorAll('[data-photo-url], [data-eval-photo-url], .photo-card img, .saved-photo-tile img').forEach(node => {
                const canonical = node.getAttribute('data-photo-url') || node.getAttribute('data-eval-photo-url') || node.closest('[data-photo-url]')?.getAttribute('data-photo-url');
                add(canonical || node.getAttribute('data-src') || node.currentSrc || node.src);
            });
        }
    }
    const sources = [typeof fullInventory !== 'undefined' ? fullInventory : [],state.fullInventory];
    if (state.noteScope === getSupabaseReadIdentityScope()) sources.push(state.locationSalesNotes);
    for (const source of sources) {
        const list = source instanceof Map ? [...source.values()].flat() : Array.isArray(source) ? source : Object.values(source || {}).flat();
        list.filter(matches).forEach(add);
    }
    return [...urls];
}
