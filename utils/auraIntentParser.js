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
export function parseAuraIntent(input) {
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
