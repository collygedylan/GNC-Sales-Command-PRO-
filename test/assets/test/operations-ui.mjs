export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e = escapeHtml;
export function dockNumber(value) {
  const match = /^(?:dock\s*)?(\d{1,3})$/i.exec(String(value || '').trim());
  return match ? String(Number(match[1])) : '';
}
export function dockGroups(drops, lines) {
  const groups = new Map();
  for (const drop of drops) {
    const key = dockNumber(drop.dock_bay) || dockNumber(lines.find(l => l.load_id === drop.load_id && l.drop_number === drop.drop_number)?.dock);
    const group = groups.get(key) || { dock: key, drops: [], total: 0, checked: 0, rush: false };
    group.drops.push(drop); group.total += Number(drop.total_items || 0); group.checked += Number(drop.checked_items || 0); group.rush ||= drop.is_live_driver;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a,b) => (Number(a.dock) || 999) - (Number(b.dock) || 999));
}
export const rushBadge = active => active ? '<span class="test-rush-label" role="status">RUSH PRIORITY · LIVE DRIVER</span>' : '';
export function checkInControls(drop, docks = ['34','38','39','52']) {
  const value = drop.check_in_status ?? (drop.driver_arrived_at ? (drop.is_live_driver ? 'Live Driver' : 'Trailer') : '');
  const current = dockNumber(drop.dock_bay);
  const options = [...new Set([...docks.map(dockNumber),current].filter(Boolean))].sort((a,b)=>Number(a)-Number(b));
  return `<div class="test-checkin-controls"><label>Check-In Status<select data-check-in="${e(drop.load_id)}" aria-label="Check-In Status for ${e(drop.load_id)}">${[['','— Select Check-In —'],['Trailer','Trailer'],['Live Driver','Live Driver']].map(([v,l])=>`<option value="${v}" ${v===value?'selected':''}>${l}</option>`).join('')}</select></label><label>Dock assignment<select data-dock-assignment="${e(drop.load_id)}" aria-label="Dock assignment for ${e(drop.load_id)}"><option value="">— Assign Dock —</option>${options.map(v=>`<option value="${v}" ${v===current?'selected':''}>Dock ${v}</option>`).join('')}</select></label></div>`;
}
export function itemCards(lines, { select = false, selected = new Set(), suspend = false, dayColor = () => '', drops = [] } = {}) {
  return `<div class="test-item-list">${lines.map(l => {
    const drop = drops.find(d=>d.load_id===l.load_id&&d.drop_number===l.drop_number);
    const metrics = [['On Hand',l.ptronhand],['Review',l.ptrreviewed],['Available',l.ptravailable],['Open Stock',l.open_stock],['Loc Photo Match',l.loc_match_qty],['Loc On Hand',l.loc_on_hand]];
    const photo = /^https:\/\/apztnscvagayslumnalr\.supabase\.co\/storage\/v1\/object\/public\//.test(l.photo_link || '') ? l.photo_link : '';
    return `<article class="test-card test-item-card ${l.is_rush_priority?'test-rush':''} ${l.is_pink_tape?'test-pink':''}" data-line-id="${e(l.soc_id)}">
      <div class="test-item-heading">${select?`<input type="checkbox" data-select="${e(l.soc_id)}" aria-label="Select ${e(l.itemcode)} at ${e(l.locationcode)}" ${selected.has(l.soc_id)?'checked':''} ${l.is_pink_tape?'disabled':''}>`:''}<div><small>Tag ${e(l.tagcode || l.unique_id)} · ${e(l.contsize)}</small><h3>${e(l.itemcode)} · ${e(l.commonname)}</h3><p>${e(l.locationcode)} · ${e(l.lotcode || l.season)} · ${dockNumber(l.dock)?'Dock '+dockNumber(l.dock):'Dock unassigned'} · Load ${e(l.load_id)}</p>${rushBadge(l.is_rush_priority)}${suspend?`<span class="test-tag" style="background:${dayColor(l.planstart)}">Plan Start ${e(l.planstart || 'Not set')}</span>`:''}</div><figure class="test-media">${photo?`<img loading="lazy" src="${e(photo)}" alt="${e(l.commonname)} at ${e(l.locationcode)}">`:'<span>No photo</span>'}<span class="test-photo-count">${photo?'1':'0'}</span><figcaption>${e(l.photo_date || '')}</figcaption></figure></div>
      <div class="test-six-metrics">${metrics.map(([label,value])=>`<div class="test-kpi"><strong>${value===null||value===undefined?'—':e(value)}</strong><span>${label}</span></div>`).join('')}</div>
      <div class="test-line-status"><span class="test-tag ${e(l.tag_quality)}">${e(l.tag_quality)}</span><span>${e(l.pulled_qty)} pulled · ${e(l.verified_qty)} verified</span><strong>${e(l.shipped_qty)} / ${e(l.ordered_qty)} shipped / ordered</strong><span>Shipped QTY: ${e(l.shipped_qty)}</span>${l.is_pink_tape?'<strong>PINK TAPE · DO NOT LOAD</strong>':''}</div>
      <div class="test-actions"><button data-action="replace" data-id="${e(l.soc_id)}" ${l.shipped_qty?'disabled':''}>Replace Location</button><button data-action="mistake" data-id="${e(l.soc_id)}" ${l.shipped_qty||l.is_pink_tape?'disabled':''}>Flag Mistake</button>${suspend?`<button data-action="evaluation" data-id="${e(l.soc_id)}">MARK DONE</button><button data-action="complete-tag" data-id="${e(l.soc_id)}">COMPLETE TAG</button>`:`<button data-action="verify-dialog" data-id="${e(l.soc_id)}" ${!drop?.tagging_complete||l.is_pink_tape?'disabled':''}>Check / Verify</button>`}</div></article>`;
  }).join('') || '<p class="test-empty">No matching lines.</p>'}</div>`;
}
export function dockCards(groups) {
  return `<div class="test-dock-list" data-drill-level="1">${groups.map(g=>`<article class="test-card test-dock-card ${g.rush?'test-rush':''}"><button class="test-card-open" data-action="open-dock" data-id="${e(g.dock||'unassigned')}"><span class="test-dock-icon">${e(g.dock||'—')}</span><span><h2>${g.dock?'Dock '+g.dock:'Unassigned dock'}</h2><span>${g.drops.length} drops · ${g.total} items · ${g.total?Math.floor(100*g.checked/g.total):0}% verified</span>${rushBadge(g.rush)}</span><span aria-hidden="true">›</span></button></article>`).join('')}</div>`;
}
export function stageActions(d) {
  return `<div class="test-actions"><button data-action="pull-help">1 · Field Pulling</button><button data-action="dock-stage" data-stage="DOCK_STAGING" data-id="${e(d.drop_id)}" ${d.loading_status!=='FIELD_PULLING'?'disabled':''}>2 · Dock Staging</button><button data-action="dock-stage" data-stage="TAGGING" data-id="${e(d.drop_id)}" ${d.loading_status!=='DOCK_STAGING'?'disabled':''}>3 · Tagging Crew</button><button data-action="tagging_complete" data-id="${e(d.drop_id)}" ${d.loading_status!=='TAGGING'?'disabled':''}>Drop Tagging Complete</button><button data-action="open-drop" data-id="${e(d.drop_id)}">4 · Checker Crew</button><button data-action="load_drop" data-id="${e(d.drop_id)}" ${!d.palletization_alert_sent||d.inspector_signoff_at?'disabled':''}>5 · Certify TRAILER LOADED</button><button data-action="signoff" data-id="${e(d.drop_id)}" ${d.loading_status!=='TRAILER_LOADED'?'disabled':''}>6 · Inspector Sign-off</button></div>`;
}
export function dropCard(d, docks) {
  const percent = d.total_items ? Math.floor(100*d.checked_items/d.total_items) : 0;
  return `<article class="test-card test-drop-card ${d.is_live_driver?'test-rush':''}"><button class="test-card-open" data-action="open-drop" data-id="${e(d.drop_id)}"><span><h2>Drop ${e(d.drop_number)}</h2><span>Load ${e(d.load_id)} · ${e(d.total_items)} items · ${percent}% verified</span></span><span>›</span></button>${rushBadge(d.is_live_driver)}${checkInControls(d,docks)}<div class="test-progress" role="progressbar" aria-label="Verified" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><span style="width:${percent}%"></span></div><span class="test-tag">${e(d.loading_status.replaceAll('_',' '))}</span>${stageActions(d)}${d.inspection_ready?'<p class="test-notice">Inspector Gate open for verified rows.</p>':''}${d.palletization_alert_sent?'<p class="test-notice">READY_FOR_PALLETIZATION · Pink tape stays isolated.</p>':''}</article>`;
}
