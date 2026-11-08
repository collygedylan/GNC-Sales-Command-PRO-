import vm from 'node:vm';
import assert from 'node:assert/strict';
export function hlQuantityFixture(html, source) {
  const ctx = vm.createContext({
    escapeHtml: (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    getCardLocationOnHandValue: () => null,
    preserveCardLocationOnHand: (_row, value) => value,
    formatLocPhotoMatchQtyValue: () => 'Not verified'
  });
  vm.runInContext([
    source('parseAppNumber'),
    source('firstNonEmptyValue'),
    source('normalizeCardQuantityValue'),
    source('getCardPtrOnHandValue'),
    source('getCardPtrReviewedValue'),
    source('getCardPtrAvailableValue'),
    source('getCardOpenStockValue')
  ].join('\n'), ctx);
  const quantityStart = html.indexOf('        function buildInventoryQuantityChipsHtml(');
  const quantityEnd = html.indexOf('        function isInventoryCardMeaningfulTextValue(', quantityStart);
  assert.ok(quantityStart >= 0 && quantityEnd > quantityStart, 'shared inventory quantity renderer must be present');
  vm.runInContext(html.slice(quantityStart, quantityEnd), ctx);
  return ctx;
}
