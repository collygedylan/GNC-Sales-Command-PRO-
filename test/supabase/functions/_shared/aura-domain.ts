/** Database terminology is data, never executable model instructions. */
export const AURA_VOICES = ["Aoede", "Charon", "Fenrir", "Kore", "Puck"] as const;
export type AuraVoice = typeof AURA_VOICES[number];
export type AuraForm = "cone" | "spiral" | "pompom" | "topiary" | "tree" | "espalier";
export type AuraMetric = "open_stock" | "loc_on_hand" | "allocated" | "held";
export type AuraCropTier = "CARRY_OVER" | "CURRENT_CROP" | "FUTURE_CROP";
export type AuraGlossaryTarget = { size?: string; metric?: AuraMetric | "loc_photo_match"; cropTier?: AuraCropTier; view?: string;
  archiveTab?: "requests" | "orders" | "reserves" | "drive"; queueCategory?: "suspend-tag" | "recount" | "bunch-notes"; taskView?: string };
export type AuraGlossaryEntry = { term: string; canonical_entity: string; target_filter: AuraGlossaryTarget; definition: string | null; synonyms: string[] };
export type AuraEntity = { size_spec: string | null; base_cultivar: string | null; form_modifier: AuraForm[]; target_metric: AuraMetric; crop_tier: AuraCropTier | null };
export function auraVoice(value: unknown): AuraVoice {
  if (typeof value !== "string" || !AURA_VOICES.includes(value as AuraVoice)) throw new Error("AURA_VOICE_INVALID");
  return value as AuraVoice;
}
const clean = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function parseAuraGlossary(value: unknown): AuraGlossaryEntry[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error("AURA_GLOSSARY_INVALID");
  const terms = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("AURA_GLOSSARY_INVALID");
    const row = raw as Record<string, unknown>, filter = row.target_filter;
    if (typeof row.term !== "string" || row.term.length > 80 || !row.term.trim()
      || typeof row.canonical_entity !== "string" || !filter || typeof filter !== "object" || Array.isArray(filter)) throw new Error("AURA_GLOSSARY_INVALID");
    const term = clean(row.term), target = filter as Record<string, unknown>;
    if (terms.has(term)) throw new Error("AURA_GLOSSARY_INVALID");
    terms.add(term);
    const definition = row.definition == null ? null : typeof row.definition === "string" && row.definition.length <= 4000 ? row.definition.trim() : (() => { throw new Error("AURA_GLOSSARY_INVALID"); })();
    if (!Array.isArray(row.synonyms) || row.synonyms.length > 20 || row.synonyms.some(value => typeof value !== "string" || !value.trim() || value.length > 80)) throw new Error("AURA_GLOSSARY_INVALID");
    const synonyms = [...new Set(row.synonyms.map(value => clean(String(value))))];
    const safe: AuraGlossaryTarget = {};
    if (row.canonical_entity === "container_size") {
      if (typeof target.size !== "string" || !/^[A-Za-z0-9#& .-]{1,40}$/.test(target.size)) throw new Error("AURA_GLOSSARY_INVALID");
      safe.size = target.size.trim();
    } else if (row.canonical_entity === "metric_type") {
      if (!["open_stock", "loc_on_hand", "allocated", "held"].includes(String(target.metric))) throw new Error("AURA_GLOSSARY_INVALID");
      safe.metric = target.metric as AuraMetric;
    } else if (row.canonical_entity === "crop_tier") {
      if (!["CARRY_OVER", "CURRENT_CROP", "FUTURE_CROP"].includes(String(target.cropTier))) throw new Error("AURA_GLOSSARY_INVALID");
      safe.cropTier = target.cropTier as AuraCropTier;
    } else if (["app_feature", "inventory_metric", "analytics", "history", "queue_work"].includes(String(row.canonical_entity))) {
      if (typeof target.view !== "string" || !["inv-consolidation", "drive", "request-sales-impact", "historical-requests", "moves", "request", "tasks", "shear-list"].includes(target.view)) throw new Error("AURA_GLOSSARY_INVALID");
      safe.view = target.view;
      if (target.metric === "loc_photo_match") safe.metric = "loc_photo_match";
      if (["requests", "orders", "reserves", "drive"].includes(String(target.archiveTab))) safe.archiveTab = target.archiveTab as AuraGlossaryTarget["archiveTab"];
      if (["suspend-tag", "recount", "bunch-notes"].includes(String(target.queueCategory))) safe.queueCategory = target.queueCategory as AuraGlossaryTarget["queueCategory"];
      if (typeof target.taskView === "string" && target.taskView.length <= 80) safe.taskView = target.taskView;
    }
    return { term, canonical_entity: row.canonical_entity, target_filter: safe, definition, synonyms };
  });
}
export function matchesAuraGlossaryEntry(text: string, entry: AuraGlossaryEntry): boolean {
  const input = clean(text);
  return [entry.term, ...entry.synonyms].some(term => new RegExp(`(?:^|[^a-z0-9])${escape(clean(term))}(?=$|[^a-z0-9])`, "i").test(input));
}
export function auraForms(text: string): AuraForm[] {
  const input = clean(text);
  return ([
    ["cone", /\bcones?\b/], ["spiral", /\bspirals?\b/], ["pompom", /\bpom[ -]?poms?\b/],
    ["topiary", /\btopiar(?:y|ies)\b/], ["tree", /\btrees?\b|\btree[ -]?forms?\b/], ["espalier", /\bespaliers?\b/],
  ] as [AuraForm, RegExp][]).filter(([, pattern]) => pattern.test(input)).map(([form]) => form);
}
export function extractAuraEntity(text: string, proposed: Record<string, unknown>, glossary: AuraGlossaryEntry[]): AuraEntity {
  const input = clean(text), matched = glossary.filter(entry => matchesAuraGlossaryEntry(input, entry));
  const sizes = [...new Set(matched.map(entry => entry.target_filter.size).filter((size): size is string => Boolean(size)))];
  if (sizes.length > 1) throw new Error("AURA_SIZE_AMBIGUOUS");
  const metrics = [...new Set(matched.map(entry => entry.target_filter.metric)
    .filter((metric): metric is AuraMetric => ["open_stock", "loc_on_hand", "allocated", "held"].includes(String(metric))))];
  const cropTiers = [...new Set(matched.map(entry => entry.target_filter.cropTier).filter((tier): tier is AuraCropTier => Boolean(tier)))];
  if (cropTiers.length > 1) throw new Error("AURA_CROP_TIER_AMBIGUOUS");
  // Explicit held/allocated questions take priority over generic "on hand" wording.
  const metric = metrics.includes("held") ? "held" : metrics.includes("allocated") ? "allocated"
    : metrics.includes("loc_on_hand") ? "loc_on_hand" : metrics[0] || (/\b(?:on[ -]hold|held)\b/.test(input) ? "held" : /\ballocated\b/.test(input) ? "allocated"
      : /\bon[ -]hand\b/.test(input) ? "loc_on_hand" : proposed.metric === "ptronhand" || proposed.metric === "loc_on_hand" ? "loc_on_hand"
      : proposed.metric === "held" ? "held" : proposed.metric === "allocated" ? "allocated" : "open_stock");
  const cultivar = proposed.commonName || proposed.productText || proposed.itemcode;
  const base = typeof cultivar === "string" ? cultivar.replace(/\b(?:cones?|spirals?|pom[ -]?poms?|topiar(?:y|ies)|tree[ -]?forms?|trees?|espaliers?)\b/gi, " ").trim().replace(/\s+/g, " ") : null;
  return { size_spec: sizes[0] || (typeof proposed.contSize === "string" ? proposed.contSize : null),
    base_cultivar: base || null, form_modifier: auraForms(text), target_metric: metric, crop_tier: cropTiers[0] || null };
}

/** Only bounded, verified database values are used to compose a spoken answer. */
export function auraInventorySummary(total: number, metric: string, rows: Record<string, unknown>[], hasMore: boolean): string {
  const fmt = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(value);
  const metricLabel = ({ s_lts: "Open Stock", ptravailable: "Available", ptronhand: "On Hand", loc_on_hand: "Loc On Hand", allocated: "Allocated", held: "On Hold" } as Record<string, string>)[metric] || "Units";
  const products = [...new Set(rows.map(row => [row.contSize || row.contsize, row.commonName || row.commonname || row.itemcode].filter(Boolean).join(" ")).filter(Boolean))];
  const product = products.length === 1 ? ` ${products[0]}` : " units";
  let reply = `We currently have ${fmt(total)}${product} in ${metricLabel}.`;
  const locations = new Map<string, number | null>();
  for (const row of rows) {
    const location = row.locationCode || row.locationcode;
    if (typeof location !== "string" || !location.trim()) continue;
    const quantity = row.quantity;
    const previous = locations.get(location);
    locations.set(location, previous === null || typeof quantity !== "number" || !Number.isFinite(quantity) ? null : (previous || 0) + quantity);
  }
  if (hasMore || locations.size > 2) reply += " More locations are available in the results.";
  if (locations.size) reply += "\n" + [...locations].slice(0, 2).map(([location, quantity]) =>
    `${location}: ${quantity === null ? "quantity unavailable" : fmt(quantity)}${hasMore ? " shown" : ""}`).join("\n");
  return reply;
}
