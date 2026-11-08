import { readComposedAppSource } from '../../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
export function suspendZeroQuantityContract() {
  const source = readComposedAppSource();
  const renderContext = vm.createContext({
    parseAppNumber: value => value == null ? null : Number(value),
    preserveCardLocationOnHand: (_row,value) => value,
    escapeHtml: value => String(value ?? ''),
    normalizeCardQuantityValue: value => String(value ?? ''),
    getCardPtrOnHandValue: () => null,
    getCardPtrReviewedValue: () => null,
    getCardPtrAvailableValue: () => null,
    getCardOpenStockValue: () => null,
    formatLocPhotoMatchQtyValue: () => 'Not verified',
    getCardLocationOnHandServerAggregate: () => null,
    getCardLocationOnHandValue: () => null,
  });
  const quantityBuilder = source.match(/        function buildInventoryQuantityChipsHtml\([^]*?^        }/m)?.[0];
  assert.ok(quantityBuilder, 'quantity renderer is present');
  vm.runInContext(`${quantityBuilder}\nthis.render = buildInventoryQuantityChipsHtml;`, renderContext);
  const html = renderContext.render({ PTRONHAND: 136, PTRREVIEWED: 0, PTRAVAILABLE: 136, S_LTS: 116, LOC_MATCH_QTY: 0, LOC_ON_HAND: 0 }, {
    canonical: true, preserveUnknown: true, sourceView: 'request', queueMetricTelemetry: true,
    knownLocationOnHand: 0, knownLocationPhotoMatch: 0,
  });
  assert.match(html, /data-queue-metric="loc-photo-match">0<\/span>/);
  assert.match(html, /data-queue-metric="loc-on-hand">0<\/span>/);
}
