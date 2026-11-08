import { readComposedAppSource } from '../../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { functionSource } from './completed-row-contract.mjs';

export const html = readComposedAppSource().replace(/\r\n/g, '\n');
const evalSecurityStart = html.indexOf('        function isEvalSensitiveDataRestricted(');
const evalSecurityEnd = html.indexOf('        function runDedupeSupabaseRead(', evalSecurityStart);
assert.ok(evalSecurityStart >= 0 && evalSecurityEnd > evalSecurityStart, 'Eval security helpers should exist');
const evalSecurityHelpers = html.slice(evalSecurityStart, evalSecurityEnd);
export const NOW = Date.parse('2026-09-07T18:00:00Z');
export const DAY = 86_400_000;
export const PHOTO = 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/crop.webp';
export function source(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} is present`);
  const end = html.indexOf('\n        }', start);
  assert.notEqual(end, -1, `${name} closes`);
  return html.slice(start, end + '\n        }'.length);
}
const coreNames = ['getPhotoUrlList', 'handleDeferredCardPhotoLoadFailure', 'getDeferredCardPhotoFallbackSrc', 'firstNonEmptyValue', 'parseAppNumber', 'normalizeLocMatchPercentText', 'parseLocMatchPercent',
  'calculateLocMatchQtyValue', 'getLocPhotoEvidenceContext', 'getLocPhotoOwnedValue',
  'parseLocPhotoEvidenceTimestamp', 'getLocPhotoCaptureEvidence', 'getLocPhotoEvidenceState',
  'getPhotoQualifiedLocMatchQtyValue', 'getDepletedLocPhotoMatchQtyValue', 'getDisplayLocMatchQtyValue', 'getCurrentCardLocPhotoMatchQtyValue',
  'formatLocPhotoMatchQtyValue', 'getEditorLocMatchQtyValue', 'getManagerLocPhotoMatchQtyValue'];
export function runtime(extraNames = [], extra = {}) {
  class FixedDate extends Date { static now() { return NOW; } }
  const context = vm.createContext({ Date: FixedDate, URL, window:{}, ACTIVE_REQUEST_TABLE:'ph_requests_pending', getExpandedImageUrl:value=>String(value || ''),
    shouldPreferFlyerOwnedFields: (row, view) => view === 'flyer' || (view === 'tasks' && row?.selectedFlyer === true),
    ...extra });
  vm.runInContext(functionSource('calculateLiveLocPhotoMatch'), context);
  vm.runInContext(`${evalSecurityHelpers}\n${[...coreNames, ...extraNames].map(source).join('\n')}`, context);
  return context;
}
export const row = (changes = {}) => ({ SOURCE_TABLE: 'ph_master_inventory', MATCH: '50', INITIAL_PTR: '347',
  PTRONHAND: '347', PTRAVAILABLE: '347', LOC_MATCH_QTY: '174', PHOTO_LINK: PHOTO,
  PHOTO_NAME: 'crop.webp', AV_RULE_PHOTO_UPDATED_AT: '2026-09-06T18:00:00Z', ...changes });

