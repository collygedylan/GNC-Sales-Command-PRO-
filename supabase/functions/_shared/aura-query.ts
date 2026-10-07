/** Deterministic, compositional nursery query parsing. No database or provider access. */
import { canonicalAuraSize, cleanseAuraInventoryText, parseAuraWholeNumber } from '../../../utils/auraLingo.js';
import { AURA_DOMAIN_ROUTES, AURA_READ_CAPABILITIES, AURA_MODULE_CAPABILITIES, type AuraCapability } from './aura-capabilities.ts';
export { AURA_READ_CAPABILITIES, AURA_MODULE_CAPABILITIES, AURA_DOMAIN_ROUTES } from './aura-capabilities.ts';
export type { AuraCapability } from './aura-capabilities.ts';
export type AuraQueryMode = 'inventory' | 'ownership' | 'unassigned' | 'lot' | 'eval_work' | 'location_work' | 'requests' | 'orders' | 'dock' | 'hr' | 'calendar' | 'chat' | 'weather' | 'production' | 'photos' | 'marketing' | 'domain' | 'unknown';
export type AuraMetric = 'ptravailable' | 'ptronhand';
export type AuraIntent = {
  mode: AuraQueryMode; operation: string; question: string; filters: Record<string, unknown>;
  module: string; title: string; replyPrefix: string; capability?: string; clarification?: string;
};
const clean = (value: unknown) => String(value ?? '').normalize('NFKC').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const chicago = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function parts(date: Date) { return Object.fromEntries(chicago.formatToParts(date).map(value => [value.type, value.value])); }
function chicagoMidnight(day: Date) {
  const target = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  let candidate = target;
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(candidate));
    candidate += target - Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  }
  return new Date(candidate).toISOString();
}
/** End is exclusive; converting each midnight independently preserves DST days. */
export function auraDateRange(text: string, now = new Date()) {
  const p = parts(now); let from = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  let days = 1; let phrase = '';
  const exact = text.match(/\b(?:on|since|from|date)\s+(\d{4}-\d{2}-\d{2})\b/i);
  if (exact) { phrase = exact[0]; from = new Date(`${exact[1]}T00:00:00Z`); if (!Number.isFinite(from.getTime()) || from.toISOString().slice(0, 10) !== exact[1]) return null; }
  else {
    phrase = text.match(/\b(?:today|yesterday|tomorrow|(?:this|last|next) week|(?:this|last|next) month)\b/i)?.[0] || '';
    if (!phrase) return null;
    if (/yesterday/i.test(phrase)) from.setUTCDate(from.getUTCDate() - 1);
    if (/tomorrow/i.test(phrase)) from.setUTCDate(from.getUTCDate() + 1);
    if (/week/i.test(phrase)) { from.setUTCDate(from.getUTCDate() - (from.getUTCDay() + 6) % 7 + (/last/i.test(phrase) ? -7 : /next/i.test(phrase) ? 7 : 0)); days = 7; }
    if (/month/i.test(phrase)) { from.setUTCDate(1); from.setUTCMonth(from.getUTCMonth() + (/last/i.test(phrase) ? -1 : /next/i.test(phrase) ? 1 : 0)); days = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0)).getUTCDate(); }
  }
  const end = new Date(from); end.setUTCDate(end.getUTCDate() + days);
  return { phrase, dateFrom: chicagoMidnight(from), dateTo: exact && /^(since|from)/i.test(exact[0]) ? undefined : chicagoMidnight(end) };
}
function residual(text: string) {
  return text.replace(/\b(?:how many|how much|number of|count|show me|show|find|look up|search for|search|tell me|what about|what is|what are|what|where is|where are|where|who has|who owns|who is assigned to|who|is there|do we have|we have|in stock|open stock|available|on[ -]hand|physical stock|inventory|stock|plants?|distinct items?|unique items?|physical rows?|items?|rows?|records?|only|just|and|those|these|there|same|all|please|can you|with|for|at|in|the|a|an|of|from|now|current|status|list|summary|details?|about)\b/gi, ' ')
    .replace(/[?!;]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,.:]+|[\s,.:]+$/g, '').trim();
}
const writeWords = /\b(?:create|prepare|draft|submit|save|approve|deny|edit|update|change|move|assign|reclass|complete|finish|send|message|delete|cancel|release|deploy|merge)\b/i;

export function resolveAuraIntent(raw: unknown, context: Record<string, unknown> = {}, now = new Date()): AuraIntent {
  const question = clean(raw);
  if (!question || question.length > 2000) throw new Error('AURA_QUERY_TEXT_REQUIRED');
  const prior = record(context.lastIntent), priorFilters = record(prior.filters);
  const follow = /^(?:and\b|only\b|just\b|what about\b|how about\b|same\b|those\b|these\b|there\b)|\b(?:those|these|there|same ones)\b/i.test(question)
    || (!!prior.mode && /^(?:on[ -]hand|available|#\d+)[?.!]*$/i.test(question));
  const intent: AuraIntent = { mode: 'inventory', operation: 'stock', question, filters: {}, module: 'drive', title: 'Inventory', replyPrefix: 'Inventory' };
  const clarify = (message: string) => ({ ...intent, clarification: message });
  const navigation = question.match(/^(?:please\s+)?(?:open|go to|take me to|navigate to)\s+(?:the\s+)?(.+?)[?.!]*$/i);
  if (navigation) {
    const destination = navigation[1].toLowerCase().replace(/[?.!]$/, '').replace(/\s+screen$/, '').replace(/\s+/g, '-');
    const aliases: Record<string, string> = { inventory: 'drive', 'location-work': 'tasks', 'eval-work': 'review', calendar: 'department-calendar', settings: 'managers', operations: 'managers', propagation: 'production:propagation', planting: 'production:planting', 'sales-credits': 'sales-credit', marketing: 'advertisement' };
    const target = aliases[destination] || destination;
    const entry = AURA_MODULE_CAPABILITIES[target as keyof typeof AURA_MODULE_CAPABILITIES];
    if (entry && entry.available) return { ...intent, mode: 'domain', operation: 'navigate', capability: 'navigation', module: target,
      title: 'App navigation', filters: { navigationView: entry.reviewView, ...(destination === 'operations' ? { operations: true } : {}) } };
    return clarify('Which app screen should I open? Ask for app areas to see the available destinations.');
  }
  if (follow && !prior.mode) return clarify('Which plants or records should I use for that follow-up?');
  if (follow && /\b(?:those|these|there)\b/i.test(question) && Array.isArray(context.pendingChoices) && context.pendingChoices.length > 1) return clarify('Which of the previous matches do you mean? Choose one of the listed options.');
  if (follow) Object.assign(intent, prior, { question, filters: { ...priorFilters } });
  const f = intent.filters;
  // Extract exact identifiers before normalizing spoken sizes: "00123 in C.06"
  // must never be interpreted as a 123-inch container.
  let remaining = question.replace(/[’]/g, "'");
  const remove = (pattern: RegExp) => { const m = remaining.match(pattern); if (m) remaining = remaining.replace(pattern, ' '); return m; };
  const item = remove(/\b(?:item\s*code|itemcode|item)\s*(?:#|:)?\s*([A-Z0-9][A-Z0-9_-]{1,99})\b/i);
  if (item) { f.itemcode = item[1]; delete f.productText; delete f.selectionId; }
  else if (/^\d{3,}$/.test(remaining)) { f.itemcode = remaining; remaining = ''; delete f.productText; delete f.selectionId; }
  const loc = remove(/\b[A-Z]\.[0-9]{2}(?:\.[0-9]{3})?\b/i);
  if (loc) { f.locationCode = loc[0].toUpperCase(); f.locationMode = loc[0].split('.').length === 2 ? 'prefix' : 'exact'; }
  const bay = remove(/\bbay\s*(?:#|:)?\s*(\d{1,3})\b/i);
  if (bay) {
    if (typeof f.locationCode === 'string') { f.locationCode = f.locationCode.split('.').slice(0, 2).join('.') + '.' + bay[1].padStart(3, '0'); f.locationMode = 'exact'; }
    else f.bay = bay[1].padStart(3, '0');
  }
  const lot = remove(/\b(?:lot\s*code|lot)\s*(?:#|:)?\s*([A-Z0-9][A-Z0-9._-]{1,63})\b/i);
  if (lot) f.lotcode = lot[1].toUpperCase();
  remaining = cleanseAuraInventoryText(remaining);
  const sizes = [...remaining.matchAll(/(?:^|\s)(#\d+(?:\.\d+)?|\d+(?:\.\d+)?DP|\d+(?:\.\d+)?\s+(?:IN|FT|QT|PT|CELL|TRAY))(?=\s|$|[?,.!])/gi)];
  if (sizes.length > 1) return clarify('Please choose one container size for this query.');
  if (sizes[0]) { f.contSize = canonicalAuraSize(sizes[0][1]); remaining = remaining.replace(sizes[0][0], ' '); delete f.selectionId; }
  const season = remove(/\b(?:season\s+)?((?:20)?\d{2}[.\s-]?)?(S1|F1|U1|U2|U3|X|Y|Z)\b/i);
  if (season) {
    f.season = season[2].toUpperCase();
    if (season[1]) f.salesYear = Number(season[1].replace(/\D/g, '')) % 100;
    else delete f.salesYear;
  }
  const zone = remove(/\b(?:(outside|inside|in|within)\s+(?:the\s+)?)?perennial\s+(?:area|zone)\b/i);
  if (zone) f.zone = zone[1]?.toLowerCase() === 'outside' ? 'OUTSIDE' : 'perennial';
  const genus = remove(/\bgenus\s+([a-z][a-z-]{1,79})\b/i);
  if (genus) { f.genus = genus[1]; delete f.productText; delete f.selectionId; }
  const ownQuestion = /\b(?:who owns|who has|who is assigned to)\b/i.test(question);
  const zoe = remove(/\bzoe(?:_green| green)?(?:'s|s)?\b/i);
  if (zoe) f.assignee = 'zoe_green';
  if (!ownQuestion && !zoe) {
    const person = remove(/\b(?:owned by|assigned to|assignee|worker)\s+([a-z][a-z_'-]*(?:\s+[a-z][a-z_'-]*)?)(?=\s+(?:in|at|for|on|with|from|only)\b|[?.,!]|$)/i);
    if (person) { f.assigneeText = person[1]; delete f.assignee; }
  }
  if (/\bon[ -]hand|physical stock\b/i.test(question)) f.metric = 'ptronhand';
  else if (/\bavailable\b/i.test(question) || !follow) f.metric = 'ptravailable';
  if (/\bopen stock\b/i.test(question)) f.openStockOnly = true;
  else if (!follow || /\ball stock\b/i.test(question)) f.openStockOnly = false;
  if (/\b(?:physical rows?|rows?)\b/i.test(question)) f.countMode = 'physical_rows';
  else if (/\b(?:distinct|unique) (?:items?|plants?|products?)|plant types?\b/i.test(question)) f.countMode = 'unique_items';
  else if (!follow || /\bquantity\b/i.test(question)) f.countMode = 'quantity';
  const date = auraDateRange(question, now);
  if (!date && /\b(?:on|since|from|date)\s+\d{4}-\d{2}-\d{2}\b/i.test(question)) return clarify('Please use a valid date in YYYY-MM-DD format.');
  if (date) { f.dateFrom = date.dateFrom; if (date.dateTo) f.dateTo = date.dateTo; else delete f.dateTo; remaining = remaining.replace(date.phrase, ' '); }
  const status = remove(/\b(?:pending|approved|denied|cancelled|completed|complete|outstanding|in progress|open|active|submitted|closed)\b/i);
  if (status && !/\bopen stock\b/i.test(question) && !/\b(?:app areas?|modules?|navigation)\b/i.test(question)) f.status = /^(?:outstanding)$/i.test(status[0]) ? 'open' : /^(?:completed)$/i.test(status[0]) ? 'complete' : status[0].toLowerCase().replace(/ /g, '_');
  const recordId = remove(/\b(?:record|job|task|conversation)\s+(?:id\s*)?([0-9a-f]{8}-[0-9a-f-]{27,})\b/i);
  if (recordId) f.recordId = recordId[1];
  const route = AURA_DOMAIN_ROUTES.find(value => value.pattern.test(question));
  if (/\b(?:can filling|order pulling)\b/i.test(question)) return clarify('That feature is not yet available in the app.');
  if (/\b(?:chat|messages?|conversation|walkie|call)\b/i.test(question)) {
    Object.assign(intent, { mode: 'chat', operation: 'read', module: 'chat', title: 'Chat messages', capability: undefined });
    remaining = remaining.replace(/\b(?:chat|messages?|conversation|walkie|call|read|my|latest|recent|private|authorized)\b/gi, ' ');
  } else if (/\b(?:location work|worksheets?)\b/i.test(question)) {
    Object.assign(intent, { mode: 'location_work', operation: 'read', module: 'tasks', title: 'Location Work', capability: 'location_work' });
    remaining = remaining.replace(/\b(?:location work|worksheets?)\b/gi, ' ');
  } else if (/\b(?:eval(?:uation)? work|eval(?:uation)? tasks?|worker assignments?)\b/i.test(question)) {
    Object.assign(intent, { mode: 'eval_work', operation: 'read', module: 'review', title: 'Eval Work', capability: 'eval_work' });
    remaining = remaining.replace(/\b(?:eval(?:uation)? work|eval(?:uation)? tasks?|worker assignments?)\b/gi, ' ');
  } else if (route) {
    const key = route.capability === 'po_fall' && f.season === 'S1' ? 'po_spring' : route.capability;
    const cap = AURA_READ_CAPABILITIES[key];
    Object.assign(intent, { mode: 'domain', operation: /\b(?:count|how many|number of)\b/i.test(question) ? 'count' : 'read', capability: key, module: cap.module, title: cap.title });
    remaining = remaining.replace(new RegExp(route.pattern.source, 'gi'), ' ');
    remaining = remaining.replace(/\b(?:department|latest|recent|stored|recorded|published|visible|does|look like)\b/gi, ' ').replace(/(?:^|\s)'s\b/gi, ' ');
    if (key === 'active_request') { if (f.status === 'active') delete f.status; remaining = remaining.replace(/\brequests?\b/gi, ' '); }
    if (key === 'navigation') remaining = remaining.replace(/\b(?:which|can|i|open)\b/gi, ' ');
  } else if (/\brequests?\b/i.test(question)) {
    Object.assign(intent, { mode: 'domain', operation: 'read', capability: 'request_queue', module: 'request', title: 'Requests' }); remaining = remaining.replace(/\b(?:active )?requests?\b/gi, ' ');
  } else if (/\borders?\b/i.test(question)) {
    Object.assign(intent, { mode: 'domain', operation: 'read', capability: 'sales_orders', module: 'sales-office', title: 'Orders' }); remaining = remaining.replace(/\borders?\b/gi, ' ');
  } else if (ownQuestion || (zoe && !/\b(?:where|how many|how much|count)\b/i.test(question) && !follow)) Object.assign(intent, { mode: 'ownership', operation: 'ownership', module: 'drive', title: 'Effective Eval ownership', capability: undefined });
  else if (/\bunassigned\b/i.test(question)) { Object.assign(intent, { mode: 'unassigned', operation: 'unassigned', module: 'drive', title: 'Explicitly Unassigned inventory', capability: undefined }); remaining = remaining.replace(/\bunassigned\b/gi, ' '); }
  else if (lot && !/\b(?:where|how many|count)\b/i.test(question)) Object.assign(intent, { mode: 'lot', operation: 'lot', capability: undefined });
  else if (/\bwhere\b/i.test(question)) Object.assign(intent, { mode: 'inventory', operation: 'locations', capability: undefined });
  else if (/\b(?:most|highest|maximum)\b/i.test(question)) { Object.assign(intent, { mode: 'inventory', operation: 'maximum', capability: undefined }); remaining = remaining.replace(/\b(?:most|highest|maximum)\b/gi, ' '); }
  else if (['inventory', 'ownership', 'lot'].includes(intent.mode) && /\b(?:how many|how much|count)\b/i.test(question)) Object.assign(intent, { mode: 'inventory', operation: 'stock', capability: undefined });
  if (zoe) remaining = remaining.replace(/\b(?:owned by|assigned to)\b/gi, ' ');
  let product = residual(remaining);
  if (product && !/^(?:recent|latest|read|by|to)$/i.test(product)) {
    // A new product explicitly replaces any selected or remembered product.
    f.productText = product; delete f.selectionId;
    if (!item) delete f.itemcode;
  }
  if (follow && /^(?:and|only|just|what about|how about)\s*$/i.test(product)) delete f.productText;
  if (!follow && !route && !item && !loc && !lot && !genus && !zoe && !/\b(?:how many|how much|where|who|count|find|show|look up|inventory|stock|plants?|items?|rows?|most|highest|maximum)\b/i.test(question) && intent.mode === 'inventory') return clarify('I can query nursery records and prepare app changes for review. Please name the plants, records, or app area you want.');
  if (/\bthose\b/i.test(question) && product === 'those') delete f.productText;
  if (['inventory','ownership','unassigned','lot'].includes(intent.mode) && (f.status || f.dateFrom || f.bay)) return clarify('Please use a full location for a bay query. Inventory queries use current stock and ownership; use the relevant workflow or history for statuses and dates.');
  if (writeWords.test(question)) {
    const quantity = question.match(/\b(?:quantity|qty)\s*[:=]?\s*([a-z\d, -]+?)(?=\s+(?:of|to|in|at|for)\b|[?.!]|$)/i);
    if (quantity) { const n = parseAuraWholeNumber(quantity[1]); if (n != null) f.quantity = n; }
  }
  intent.replyPrefix = intent.title;
  return intent;
}
export function capabilityForIntent(intent: AuraIntent): AuraCapability[] {
  if (intent.capability) return AURA_READ_CAPABILITIES[intent.capability] ? [AURA_READ_CAPABILITIES[intent.capability]] : [];
  const key: Partial<Record<AuraQueryMode, string>> = { eval_work: 'eval_work', location_work: 'location_work', requests: 'request_queue', orders: 'sales_orders', dock: 'dock_trips', hr: 'hours', calendar: 'calendar', weather: 'weather_daily', production: 'production_work', photos: 'photo_history', marketing: 'marketing' };
  return key[intent.mode] ? [AURA_READ_CAPABILITIES[key[intent.mode]!]] : [];
}
export function normalizeSearch(value: unknown) { return clean(value).toLowerCase().slice(0, 160); }
export function escapeAuraLike(value: string) { return value.replace(/[\\%_*]/g, char => `\\${char}`); }
