// 0c10a7ce and 8a17ad91 added durable Reclass photo evidence to full and browse reads.
const approvedPhotoEvidence = new Set([
  'photo_date', 'loc_match_pct', 'loc_photo_match', 'baseline_on_hand',
  'initial_photo_match_qty', 'eval_baseline_available', 'initial_loc_photo_match'
]);

export function validateHistoricalProjection(previous, current) {
  const baseline = previous.split(',');
  const candidate = current.split(',');
  const original = new Set(baseline);
  const retained = candidate.filter(field => original.has(field));
  const additions = candidate.filter(field => !original.has(field));
  if (new Set(baseline).size !== baseline.length || new Set(candidate).size !== candidate.length
      || retained.join(',') !== previous || additions.length !== approvedPhotoEvidence.size
      || additions.some(field => !approvedPhotoEvidence.has(field))) {
    throw new Error('PERFORMANCE_INVENTORY_PROJECTION_SEMANTICS_CHANGED');
  }
  return current;
}

export function compatibleBaselineProjections(source, browse, full) {
  const extract = name => {
    const start = source.indexOf(`const ${name} = [`);
    if (start < 0) throw new Error(`PERFORMANCE_BASELINE_PROJECTION_MISSING:${name}`);
    const end = source.indexOf('].join(",");', start);
    if (end < 0) throw new Error(`PERFORMANCE_BASELINE_PROJECTION_INVALID:${name}`);
    return [...source.slice(start, end).matchAll(/"([^"]+)"/g)].map(match => match[1]).join(',');
  };
  return {
    browse: validateHistoricalProjection(extract('INVENTORY_MASTER_BROWSE_FIELDS'), browse),
    full: validateHistoricalProjection(extract('INVENTORY_MASTER_FULL_FIELDS'), full)
  };
}
