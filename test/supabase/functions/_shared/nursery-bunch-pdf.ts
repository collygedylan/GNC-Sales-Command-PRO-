import { buildBunchNotesBlockPdfDocument } from '../../../services/bunch-note-pdf.mjs';
import type { Database } from './database.types.ts';
type ReadRelation<Row> = {Row:Row;Insert:never;Update:never;Relationships:[]};
export type NurseryPdfDatabase = Database & {public:{Tables:{
  user_access:ReadRelation<{profile_id:string;view_nursery_command_tables:string;view_permissions:Record<string,unknown>}>;
  ph_dylan_decisions_store:ReadRelation<{plan_id:string;decision:string;from_loc:string;itemcode:string;lot_date:string;notes:string;updated_at:string}>;
}}};
export type NurseryPdfCard = {plan_id:string;itemcode:string;commonname:string;contsize:string;lotcode:string;notes:string;target:string;crew:string;tape:string;direction:string;qty:number;available:number;updated_at:string};
export type NurseryPdfInput = {locationCode:string;cards:NurseryPdfCard[];metrics:Record<string,number>};
export function validateNurseryPdfInput(value: unknown): NurseryPdfInput {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw Error('NURSERY_PDF_INVALID');
  const p=value as Record<string,unknown>;
  if (!/^[A-L]\.\d{2}\.\d{3}$/.test(String(p.locationCode)) || !Array.isArray(p.cards) || !p.cards.length || p.cards.length>1500 || JSON.stringify(p).length>2_000_000) throw Error('NURSERY_PDF_INVALID');
  const ids=new Set<string>();
  for(const item of p.cards){
    if(!item||typeof item!=='object'||Array.isArray(item))throw Error('NURSERY_PDF_CARD_INVALID');
    const c=item as Record<string,unknown>;
    for(const key of ['plan_id','itemcode','commonname','contsize','lotcode','notes','target','crew','tape','direction','updated_at'])if(typeof c[key]!=='string'||(c[key] as string).length>12000)throw Error('NURSERY_PDF_CARD_INVALID');
    if(!String(c.plan_id).startsWith('BN-')||!c.notes||ids.has(String(c.plan_id))||!Number.isFinite(c.qty)||!Number.isFinite(c.available))throw Error('NURSERY_PDF_CARD_INVALID');
    ids.add(String(c.plan_id));
  }
  if(!p.metrics||typeof p.metrics!=='object'||Array.isArray(p.metrics)||['total','occupied','reserved','open'].some(k=>!Number.isFinite((p.metrics as Record<string,unknown>)[k])))throw Error('NURSERY_PDF_METRICS_INVALID');
  return p as unknown as NurseryPdfInput;
}
export function assertNurseryPdfApprovals(input:NurseryPdfInput, rows:Record<string,unknown>[]) {
  const byId=new Map(rows.map(r=>[String(r.plan_id),r]));
  for(const c of input.cards){const r=byId.get(c.plan_id);
    if(!r||!['✅ APPROVE','🔧 MODIFY / BUILD ON'].includes(String(r.decision))||String(r.from_loc)!==input.locationCode||r.itemcode!==c.itemcode||r.lot_date!==c.lotcode||r.notes!==c.notes||r.updated_at!==c.updated_at)throw Error('NURSERY_PDF_APPROVAL_CHANGED');
  }
}
export async function renderNurseryPdf(input:NurseryPdfInput, actor:string){return await buildBunchNotesBlockPdfDocument(input.locationCode,input.cards,input.metrics,actor);}
