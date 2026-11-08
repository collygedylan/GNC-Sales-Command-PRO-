import assert from 'node:assert/strict';

export function extractEvalFixtureBlock(html, startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `source block exists: ${startMarker}`);
  const body = html.slice(start, end);
  if (startMarker !== 'async function submitEvalWork(') return body;
  return extractEvalFixtureBlock(html, 'function getEvalWorkOriginSourceRow(',
    'function buildEvalWorkRequestDriveBaselineEvidence(') + '\n' + body;
}
