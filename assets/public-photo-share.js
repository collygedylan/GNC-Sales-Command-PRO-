let publicPhotoSharePromise = null;

function renderPublicShareCard(item) {
    const labels = {commonname:'Common Name',contsize:'Container Size',itemcode:'Item Code',locationcode:'Location Code',lotcode:'Lot / Season',qty:'Qty',spec:'Spec',caliper:'Caliper',loc_photo_match:'Loc Photo Match',available:'Available',av_note:'AV Note',pick_note:'Pick Note',comments:'Comments'};
    const photos = (item.photos || []).map(photo => directInlinePhotoUrl(photo.url || photo)).filter(Boolean);
    const text = Object.entries(labels).filter(([key]) => item[key] !== null && item[key] !== undefined && item[key] !== '').map(([key,label]) => `${label}: ${item[key]}`).join('\n');
    return renderInlineChatMessage('AGDATA_SHARE_V1:' + JSON.stringify({text,photos}));
}

async function readPublicShareItems(params) {
    const requestId = params.get('request_id') || '';
    if (/^[A-Za-z0-9][A-Za-z0-9:_-]{7,159}$/.test(requestId)) {
        const { response, result } = await fetchPublicRequestPhotoShare(requestId);
        if (!response.ok || !result?.ok) throw new Error('Shared photos are unavailable.');
        return result.items || [];
    }
    const photos = [params.get('photo'), params.get('p')].filter(Boolean).join(',').split(',')
        .map(directInlinePhotoUrl).filter(Boolean).map(url => ({url}));
    return photos.length ? [{commonname:params.get('title') || 'Shared photos', photos}] : [];
}

async function openPublicPhotoShare() {
    const host = document.createElement('main');
    host.id = 'public-inline-photo-share';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;overflow:auto;background:#113221;color:#fff;padding:24px;';
    host.innerHTML = '<div style="max-width:760px;margin:auto;">Loading shared photos…</div>';
    document.body.appendChild(host);
    try {
        const items = await readPublicShareItems(new URLSearchParams(window.location.search));
        const cards = items.map(renderPublicShareCard).join('');
        host.innerHTML = `<div style="max-width:760px;margin:auto;"><h1 style="font-size:24px;font-weight:800;">Shared photos</h1>${cards || '<p>No public photos were found for this share.</p>'}</div>`;
    } catch {
        host.innerHTML = '<p>Shared photos could not be loaded. Please reopen the original share.</p>';
    }
}

function renderPublicPhotoShare() {
    publicPhotoSharePromise ||= openPublicPhotoShare();
    return publicPhotoSharePromise;
}
