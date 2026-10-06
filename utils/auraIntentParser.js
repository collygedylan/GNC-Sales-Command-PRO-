import { cleanseAuraInventoryText, parseAuraWholeNumber, readAuraProduct } from "./auraLingo.js?v=V2026.10.06.001";

function readInventoryScope(input) {
  let text = cleanseAuraInventoryText(input);
  // Match the shell's APP_SEASON_DISPLAY_ORDER. Bare x/y/z can be cultivar
  // text; those non-saleable buckets require the explicit word "season".
  if (/\b(?:F2|S2)\b/i.test(text)) return null;
  const seasons = [...new Set([
    ...(text.match(/\b(?:U1|U2|U3|F1|S1)\b/gi) ?? []),
    ...[...text.matchAll(/\bseason\s+([XYZ])\b/gi)].map(match => match[1]),
  ].map(value => value.toUpperCase()))];
  const locations = [...new Set((text.match(/\b[A-Z]\.\d{1,3}(?:\.\d{1,3}){0,2}\b/gi) ?? []).map(value => value.toUpperCase()))];
  if (seasons.length > 1 || locations.length > 1) return null;
  const metric = /\b(?:PTRONHAND|on[- ]hand)\b/i.test(text) ? "ptronhand" : "ptravailable";
  if (metric === "ptronhand" && /\b(?:PTRAVAILABLE|available)\b/i.test(text)) return null;
  const openStockOnly = /\bopen\s+stock\b/i.test(text);
  text = text
    .replace(/\b(?:are|is)\s+(?=(?:in|at)\s+(?:open\s+stock|stock|season\b|location\b|U[123]\b|[FS]1\b|[A-Z]\.\d))/gi, " ")
    .replace(/\b(?:(?:in|at|for)\s+)?(?:season\s+)?(?:U1|U2|U3|F1|S1)\b/gi, " ")
    .replace(/\b(?:(?:in|at|for)\s+)?season\s+[XYZ]\b/gi, " ")
    .replace(/\b(?:(?:in|at|for)\s+)?(?:location\s+)?[A-Z]\.\d{1,3}(?:\.\d{1,3}){0,2}\b/gi, " ")
    .replace(/\b(?:PTRAVAILABLE|PTRONHAND|on[- ]hand|available)\b/gi, " ")
    .replace(/\b(?:do\s+we\s+have|are\s+there)\b/gi, " ")
    .replace(/\b(?:(?:in|at)\s+)?(?:open\s+stock|stock)\b/gi, " ")
    .replace(/\b(?:in|at|for)\s*$/i, " ").replace(/\s+/g, " ").trim();
  return { text, metric, openStockOnly, season: seasons[0] ?? null, locationCode: locations[0] ?? null };
}
function readDraftLine(input) {
  const text = input.replace(/^add\s+/i, "").trim();
  const suffix = text.match(/^(.+?)\s+(?:quantity|qty)\s+(.+)$/i);
  if (suffix) {
    const quantity = parseAuraWholeNumber(suffix[2]), product = readAuraProduct(suffix[1]);
    return quantity > 0 && product?.contSize ? { type: "ADD_REQUEST_ITEM", quantity, ...product } : null;
  }
  const words = text.split(/\s+/);
  for (let split = Math.min(12, words.length - 1); split >= 1; split -= 1) {
    const quantity = parseAuraWholeNumber(words.slice(0, split).join(" "));
    if (!(quantity > 0)) continue;
    const product = readAuraProduct(words.slice(split).join(" "));
    if (product?.contSize) return { type: "ADD_REQUEST_ITEM", quantity, ...product };
  }
  return null;
}
function parseAuraV2Intent(text, { auraMode = "IDLE" } = {}) {
  if (text.length > 512) return { type: "unknown", raw: text };
  const start = text.match(/^(?:please\s+)?(?:start|create|build|begin)\s+(?:a\s+)?request\s+for\s+(.+)$/i);
  if (start) return { type: "START_REQUEST", customerName: cleanName(start[1]) };
  if (/^(?:review|show)\s+(?:my\s+|the\s+)?(?:request|order|cart)$/i.test(text)) return { type: "REVIEW_REQUEST" };
  if (/^cancel\s+(?:my\s+|the\s+)?(?:request|order|cart)$/i.test(text)) return { type: "CANCEL_REQUEST" };
  if (/^(?:undo|remove\s+(?:the\s+)?last\s+item)$/i.test(text)) return { type: "UNDO_REQUEST_ITEM" };
  if (/^resume\s+(?:my\s+|the\s+)?(?:request|order|cart)$/i.test(text)) return { type: "RESUME_REQUEST" };
  if (auraMode === "CHOOSING") {
    const number = parseAuraWholeNumber(text.replace(/^(?:option|number)\s+/i,""));
    if (number >= 1 && number <= 5) return { type: "CHOOSE_MATCH", index: number - 1 };
  }
  const inventoryText = cleanseAuraInventoryText(text);
  const maximum = inventoryText.match(/^(?:(?:what|which)\s+(?:item|sku|plant)\s+has\s+(?:the\s+)?|(?:show|find)\s+(?:me\s+)?(?:the\s+)?(?:item\s+with\s+(?:the\s+)?)?|(?:the\s+)?)(?:largest|highest|most)\b\s*(.*)$/i);
  if (maximum) {
    const scope = readInventoryScope(maximum[1]);
    if (!scope) return { type: "unknown", raw: text };
    const remainder = scope.text.replace(/\b(?:value|quantity|count|stock|inventory)\b/gi, "").replace(/[,.!?]/g, "").trim();
    if (remainder) return { type: "unknown", raw: text };
    const { text: ignored, ...filters } = scope;
    return { type: "CHECK_INVENTORY_MAX", ...filters };
  }
  const count = inventoryText.match(/^(?:how\s+many|count|check|show\s+me|find)\s+(.+)$/i);
  if (count) {
    const scope = readInventoryScope(count[1]), product = scope && readAuraProduct(scope.text);
    if (!product) return { type: "unknown", raw: text };
    const { text: ignored, ...filters } = scope;
    return { type: "CHECK_INVENTORY_COUNT", ...product, ...filters };
  }
  if (auraMode === "BUILDING_REQUEST") return readDraftLine(text);
  return null;
}
const NUMBER_WORDS = new Map([
  ["zero", 0], ["one", 1], ["two", 2], ["three", 3], ["four", 4],
  ["five", 5], ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9],
  ["ten", 10], ["eleven", 11], ["twelve", 12], ["thirteen", 13],
  ["fourteen", 14], ["fifteen", 15], ["sixteen", 16], ["seventeen", 17],
  ["eighteen", 18], ["nineteen", 19], ["twenty", 20], ["thirty", 30],
  ["forty", 40], ["fifty", 50], ["sixty", 60], ["seventy", 70],
  ["eighty", 80], ["ninety", 90],
]);

function numberValue(value) {
  const direct = String(value ?? "").trim().replace(/,/g, "");
  if (/^\d+(?:\.\d+)?$/.test(direct)) return Number(direct);
  const words = direct.toLowerCase().replace(/-/g, " ").split(/\s+/).filter(Boolean);
  let total = 0;
  let current = 0;
  for (const word of words) {
    if (word === "and") continue;
    if (word === "hundred") { current = Math.max(1, current) * 100; continue; }
    const value = NUMBER_WORDS.get(word);
    if (value == null) return null;
    if (value >= 20 && value % 10 === 0) current += value;
    else if (value < 20 && current >= 20 && value < 10) current += value;
    else { total += current; current = value; }
  }
  return total + current;
}

function normalizeSize(raw) {
  const value = String(raw ?? "").trim().toLowerCase().replace(/^#\s*/, "").replace(/\s+/g, " ");
  const gallon = value.match(/^(\d+(?:\.\d+)?|[a-z -]+?)\s*(?:gallon|gallons|gal\.?|#)$/i);
  if (gallon) {
    const number = numberValue(gallon[1]);
    if (number != null) return `#${number}`;
  }
  const numberAndUnit = value.match(/^(\d+(?:\.\d+)?|[a-z -]+?)\s*(inch|inches|in\.?|foot|feet|ft\.?|quart|quarts|qt\.?|pint|pints|pt\.?|cell|cells|tray|trays)$/i);
  if (numberAndUnit) {
    const number = numberValue(numberAndUnit[1]);
    if (number != null) {
      const unit = numberAndUnit[2].toLowerCase().replace(/\.?$/, "");
      const units = { inches: "IN", inch: "IN", in: "IN", foot: "FT", feet: "FT", ft: "FT", quart: "QT", quarts: "QT", qt: "QT", pint: "PT", pints: "PT", pt: "PT", cell: "CELL", cells: "CELL", tray: "TRAY", trays: "TRAY" };
      return `${number} ${units[unit] || unit.toUpperCase()}`;
    }
  }
  const nativeFormat = value.match(/^#?\s*(\d+(?:\.\d+)?)(?:\s*(gal|g|in|ft|qt|pt))?$/i);
  if (nativeFormat) return nativeFormat[2] ? `#${nativeFormat[1]}` : `#${nativeFormat[1]}`;
  return value ? value.toUpperCase() : null;
}

function cleanName(value) {
  return String(value ?? "").replace(/[,.!?;:]+$/g, "").replace(/\s+/g, " ").trim();
}

function normalizeTranscript(input) {
  return String(input ?? "").trim().replace(/^(?:hey\s+)?aura[,:\s]+/i, "").replace(/[.!?]+$/g, "").trim();
}

function matchSizeAndName(raw) {
  const text = cleanName(raw);
  const size = text.match(/(?:^|\s)(#\s*\d+(?:\.\d+)?(?:\s*(?:gallons?|gal\.?|inches?|in\.?|feet|foot|ft\.?|quarts?|qt\.?|pints?|pt\.?|cells?|trays?))?|(?:\d+(?:\.\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?\s*(?:gallons?|gal\.?|inches?|in\.?|feet|foot|ft\.?|quarts?|qt\.?|pints?|pt\.?|cells?|trays?))(?=\s|$)/i);
  if (!size) return null;
  const contsize = normalizeSize(size[1]);
  const commonname = cleanName(`${text.slice(0, size.index)} ${text.slice(size.index + size[0].length)}`);
  if (!commonname) return null;
  return { commonName: commonname, contSize: contsize };
}

/** Parse AURA's supported spoken or typed commands into normalized data intents. */
export function parseAuraIntent(input, context = {}) {
  const text = normalizeTranscript(input);
  if (!text) return { type: "unknown", raw: "" };

  const chatMatch = text.match(/^(?:please\s+)?send\s+(?:a\s+)?message\s+to\s+(.+?)\s+saying\s+(.+)$/i);
  if (chatMatch) {
    const recipientName = cleanName(chatMatch[1]);
    const message = String(chatMatch[2] ?? "").trim().replace(/[.!?]+$/g, "");
    const department = /\b(?:department|team|office|crew|everyone|all\s+(?:staff|employees|managers))\b/i.test(recipientName)
      || /^(?:plant evaluators|kiers\s*(?:and|&)\s*counters|sales|production|managers|inventory|office)$/i.test(recipientName);
    if (recipientName && message) {
      return {
        type: "chat",
        recipientType: department ? "department" : "person",
        recipientName,
        message,
      };
    }
  }

  const v2Intent = parseAuraV2Intent(text, context);
  if (v2Intent) return v2Intent;
  const orderStart = text.match(/^(?:please\s+)?(?:start|create|build|begin)\s+(?:an?\s+)?order\s+for\s+(.+)$/i);
  if (orderStart) {
    const rest = orderStart[1];
    const quantityMatch = rest.match(/(?:,?\s*quantity\s+|\s+qty\s+)([\w ,.-]+?)(?=\s*(?:,(?!\d)|$))/i);
    const quantity = quantityMatch ? numberValue(quantityMatch[1]) : null;
    const beforeQuantity = quantityMatch ? rest.slice(0, quantityMatch.index).replace(/[,\s]+$/, "") : rest;
    const customerMatch = beforeQuantity.match(/^(.+?)[,;]\s*(.+)$/);
    if (quantity != null && quantity > 0 && customerMatch) {
      const product = matchSizeAndName(customerMatch[2]);
      if (product) return { type: "order", customerName: cleanName(customerMatch[1]), ...product, quantity };
    }
  }

  const scoutMatch = text.match(/^(?:we\s+have|i\s+(?:see|found)|there\s+is|log)\s+(.+?)\s+on\s+(.+?)(?:\s+(?:at|in)\s+)?([a-z]\.?\s*\d{1,3}(?:\.\d{1,3}){0,2}(?:\s*[-/]\s*[a-z0-9]+)?)$/i);
  if (scoutMatch) {
    const product = matchSizeAndName(scoutMatch[2]);
    if (product) return { type: "scout", pestCode: cleanName(scoutMatch[1]), ...product, locationCode: cleanName(scoutMatch[3]).replace(/\s+/g, "").toUpperCase() };
  }

  const inventoryMatch = text.match(/^(?:how\s+many|count|find|show\s+me|check)\s+(.+)$/i);
  if (inventoryMatch) {
    const productText = inventoryMatch[1].replace(/\s+(?:do\s+we\s+have(?:\s+in\s+open\s+stock)?|in\s+open\s+stock|available|in\s+stock)\s*$/i, "");
    const product = matchSizeAndName(productText);
    if (product) return { type: "inventory", ...product };
  }

  return { type: "unknown", raw: text };
}

export function parseSpokenNumber(input) {
  return numberValue(input);
}

export function normalizeAuraSize(input) {
  return normalizeSize(input);
}
