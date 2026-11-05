import { auraObject } from "./aura-gemini.ts";
import { auraForms, type AuraForm } from "./aura-domain.ts";

export type AuraAppContext = { season: string; salesyear: number; settingRevision: number };
export function parseAuraAppContext(value: unknown): AuraAppContext {
  const row = auraObject(value);
  if (Object.keys(row).some(key => !["season", "salesyear", "settingRevision"].includes(key))
    || typeof row.season !== "string" || !/^(F1|S1)$/.test(row.season)
    || typeof row.salesyear !== "number" || !Number.isInteger(row.salesyear) || row.salesyear < 1 || row.salesyear > 99
    || typeof row.settingRevision !== "number" || !Number.isSafeInteger(row.settingRevision) || row.settingRevision < 0) {
    throw new Error("AURA_APP_CONTEXT_INVALID");
  }
  return { season: row.season, salesyear: row.salesyear, settingRevision: row.settingRevision };
}
export function requestedAuraVariants(text: string): AuraForm[] {
  return auraForms(text);
}
export function spokenAuraSeason(text: string): string | undefined {
  const syntax = text.replace(/["“][^"”]*["”]/g, " ");
  const matches = [...syntax.matchAll(/\b([FSU])\s*[- ]?\s*(one|two|three|[123])\b|\b(?:season\s+)?([XYZ])\b/gi)]
    .map(match => match[3]?.toUpperCase() || `${match[1].toUpperCase()}${({ one: 1, two: 2, three: 3 } as Record<string, number>)[match[2].toLowerCase()] || match[2]}`)
    .filter(value => /^(F1|S1|U[123]|X|Y|Z)$/.test(value));
  if (new Set(matches).size > 1) throw new Error("AURA_SEASON_AMBIGUOUS");
  return matches[0];
}
export function signedAuraQuantity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("AURA_RESULT_INVALID");
  return value;
}
