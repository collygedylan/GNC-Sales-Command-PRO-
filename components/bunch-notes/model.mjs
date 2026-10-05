export const crewTags = ['BOB', 'QC', 'SAM', 'RHETT', 'BUNCHERS', 'TA', 'SHARON', 'MATT'];
export const crewColors = ['#1d4ed8', '#6d28d9', '#047857', '#9a3412', '#334155', '#9f1239', '#0e7490', '#854d0e'];
export const flagColors = { red: ['#fee2e2','#991b1b'], blue: ['#dbeafe','#1e40af'], pink: ['#fce7f3','#9d174d'], yellow: ['#fef9c3','#713f12'] };
export const text = value => String(value ?? '');
export function operationalTokens(value) {
  const input = text(value), regex = /\b(red\s+flags?|blue\s+flags?|pink\s+ribbons?|yellow\s+ribbons?)\b/gi;
  const tokens = []; let offset = 0;
  for (const match of input.matchAll(regex)) {
    if (match.index > offset) tokens.push({ text: input.slice(offset, match.index) });
    tokens.push({ text: match[0], color: match[0].split(/\s/)[0].toLowerCase() });
    offset = match.index + match[0].length;
  }
  if (offset < input.length) tokens.push({ text: input.slice(offset) });
  return tokens;
}
export function normalizeNote(value) {
  const source = value.source_all || value.source || [];
  const note = { ...value, direction: text(value.direction), target_houses: text(value.target_houses),
    house_sections: (value.house_sections || []).map(s => ({ ...s })),
    actions: (value.actions || []).map(a => {
      const linked = source.filter(r => a.scope === 'rows' && a.row_ids?.includes(r.unique_id));
      return { ...a, section_id: text(a.section_id), margin_tag: text(a.margin_tag ?? a.crew),
        quantity_constraint: text(a.quantity_constraint ?? a.quantity),
        item_size: text(a.item_size ?? [...new Set(linked.map(r => r.contsize).filter(Boolean))].join(', ')),
        item_desc: text(a.item_desc ?? [...new Set(linked.map(r => r.commonname).filter(Boolean))].join(', ')),
        instructions: text(a.instructions ?? a.action_instruction) };
    }) };
  return orderNote(note);
}
export function orderNote(note) {
  const rank = new Map(note.house_sections.map((s, i) => [s.id, i + 1]));
  return { ...note, actions: [...note.actions].sort((a, b) => (rank.get(a.section_id) || 0) - (rank.get(b.section_id) || 0))
    .map((a, i) => ({ ...a, sequence_order: i + 1, sub_location: note.house_sections.find(s => s.id === a.section_id)?.name || '' })) };
}
export function moveEntry(items, id, delta) {
  const index = items.findIndex(x => x.id === id), next = index + delta;
  if (index < 0 || next < 0 || next >= items.length) return items;
  const copy = [...items]; [copy[index], copy[next]] = [copy[next], copy[index]]; return copy;
}
export function moveLine(note, id, delta) {
  const line = note.actions.find(a => a.id === id);
  if (!line) return note;
  const peers = moveEntry(note.actions.filter(a => a.section_id === line.section_id), id, delta);
  let n = 0;
  return orderNote({ ...note, actions: note.actions.map(a => a.section_id === line.section_id ? peers[n++] : a) });
}
export function freeformLine(id, sectionId = '') {
  return { id, section_id: sectionId, freeform: true, option_id: 'bb000000-0000-4000-8000-000000000001',
    kind: 'instruction', group: 'sequence', label: 'Freeform operational task', scope: 'location', row_ids: [],
    instructions: '', margin_tag: '', item_desc: '', item_size: '', quantity_constraint: '', quantity: '', percentage: '' };
}
