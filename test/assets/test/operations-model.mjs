import { textPdf } from './pdf.mjs';
export const TEST_RECIPIENT = 'dylan_collyge@greenleafnursery.com';
export const QUALITY_RANK = Object.freeze({ BLANK: 0, SP: 1, ESP: 2 });
export const DAY_COLORS = Object.freeze({ 1: '#7C3AED', 2: '#DC2626', 3: '#16A34A', 4: '#2563EB', 5: '#16A34A' });
export function normalizeItemcode(value) { return String(value ?? '').trim().replace(/\.+$/, ''); }
export function quality(value) {
  const result = String(value ?? '').trim().toUpperCase() || 'BLANK';
  if (!(result in QUALITY_RANK)) throw Error('INVALID_QUALITY_TIER');
  return result;
}
export function teamQuality(driver, helper) {
  return QUALITY_RANK[quality(driver)] >= QUALITY_RANK[quality(helper)] ? quality(driver) : quality(helper);
}
export function canPull(team, tag) { return QUALITY_RANK[quality(team)] >= QUALITY_RANK[quality(tag)]; }
export function integer(value, code = 'INVALID_QUANTITY') {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw Error(code);
  return n;
}
export function capacity(value) { return Math.min(700, Math.max(500, integer(value || 600))); }
export function eligibleSeason(value) { return /^(?:\d{2,4}\.)?(?:F1|S1)$/.test(String(value ?? '').trim().toUpperCase()); }
export function matchInventoryFamily(code, rows) {
  const key = normalizeItemcode(code);
  const exact = rows.filter(r => normalizeItemcode(r.itemcode) === key);
  if (exact.length) return exact;
  const candidates = rows.filter(r => normalizeItemcode(r.itemcode).startsWith(key + '.'));
  if (new Set(candidates.map(r => normalizeItemcode(r.itemcode))).size !== 1) throw Error('AMBIGUOUS_ITEMCODE');
  return candidates;
}
export function routeParts(location) {
  const parts = String(location ?? '').toUpperCase().match(/^([A-Z]+)[. -]?(\d+)?[. -]?(\d+)?/);
  return parts ? [parts[1], Number(parts[2] || 0), Number(parts[3] || 0)] : ['ZZZ', 99999, 99999];
}
export function routeCompare(a, b) {
  if (Boolean(a.is_rush_priority) !== Boolean(b.is_rush_priority)) return a.is_rush_priority ? -1 : 1;
  const x = routeParts(a.locationcode), y = routeParts(b.locationcode);
  return x[0].localeCompare(y[0]) || x[1] - y[1] || x[2] - y[2]
    || Number(a.day_number || 0) - Number(b.day_number || 0) || String(a.soc_id || a.unique_id).localeCompare(String(b.soc_id || b.unique_id));
}
export function dropThresholds(total, checked, mistakes) {
  total = integer(total); checked = integer(checked); mistakes = integer(mistakes);
  if (checked + mistakes > total) throw Error('INVALID_DROP_EVIDENCE');
  return { inspectionReady: total > 0 && checked * 10 >= total,
    palletizationReady: total > 0 && checked * 100 >= total * 95 && checked + mistakes === total,
    percentage: total ? Math.floor(100 * checked / total) : 0 };
}
export function validateRejection(type, total, rejected, badPhoto, goodPhoto) {
  total = integer(total); rejected = integer(rejected);
  if (!rejected || rejected > total || !String(badPhoto || '').trim()) throw Error('REJECTION_EVIDENCE_REQUIRED');
  if (type === 'R-all' && rejected !== total) throw Error('FULL_REJECTION_MUST_MATCH_LINE');
  if (type === 'R-[N]' && (rejected >= total || !String(goodPhoto || '').trim())) throw Error('PARTIAL_REJECTION_NEEDS_TWO_PHOTOS');
  if (!['R-all', 'R-[N]'].includes(type)) throw Error('INVALID_REJECTION_TYPE');
  return true;
}
export function weekdayColor(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ''));
  return m ? DAY_COLORS[new Date(+m[1], +m[2] - 1, +m[3], 12).getDay()] || '#64748b' : '#64748b';
}
export function deterministicAura(question, snapshot) {
  const q = String(question || '').toLowerCase(), lines = snapshot?.lines || [], drops = snapshot?.drops || [];
  if (/rush|driver|traffic/.test(q)) return `${lines.filter(l => l.is_rush_priority && l.line_status !== 'SHIPPED').length} open rush lines; ${drops.filter(d => d.is_live_driver && !d.dispatched_at).length} live drivers awaiting dispatch.`;
  if (/mistake|pink|reject/.test(q)) return `${(snapshot?.mistakes || []).filter(m => m.status !== 'RESOLVED').length} open mistakes. Pink-tape plants are excluded from loading.`;
  if (/bay|staging|hidden|\bhl\b/.test(q)) return `${(snapshot?.staging || []).filter(b => !b.released_at).length} of 11 HL staging bays occupied at C.12.000.`;
  if (/fleet|wingding|team/.test(q)) return `${(snapshot?.units || []).filter(u => u.status === 'OPERATIONAL').length} operational Wingding units; ${(snapshot?.teams || []).filter(t => t.active_status).length} active teams.`;
  return 'I can summarize the loaded test fleet, staging bays, mistakes and live-driver rush queue. Ask about one of those areas; I will use only the current test snapshot.';
}
export function manifestPdf(drop, lines) {
  const text = ['AGDATA TEST - SHIPPING MANIFEST', `Load: ${drop.load_id} / Drop: ${drop.drop_number}`, `Driver: ${drop.driver_name || ''}`, `Inspector: ${drop.inspector_signoff_by || ''}`, `Inspector signed: ${drop.inspector_signoff_at || ''}`, `Driver signed: ${drop.driver_signoff_at || ''}`, `Trailer seal: ${drop.trailer_seal_number || ''}`, '', 'ITEM / LOCATION / SHIPPED / ORDERED', ...lines.flatMap(l => [`${l.itemcode} / ${l.locationcode} / ${l.shipped_qty} / ${l.ordered_qty}`, String(l.commonname || '').slice(0, 90)])];
  return textPdf(text);
}
