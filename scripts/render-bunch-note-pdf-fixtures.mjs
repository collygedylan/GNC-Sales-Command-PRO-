// Synthetic reports through the deployed HTML builder. No email or database calls.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { chromium } from '@playwright/test';
const source=fs.readFileSync(new URL('../Code.gs',import.meta.url),'utf8');
const context=vm.createContext({escapeEmailHtml_:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')});
vm.runInContext(source.slice(source.indexOf('function buildBunchNotePdfHtml_'),source.indexOf('function handleBunchNotePreview_')),context);
const directory=path.resolve(process.argv[2]||'.gnc-local/bunch-pdf');fs.mkdirSync(directory,{recursive:true});
const short={note_number:'BN-SYNTHETIC',instruction_revision:2,block:'E',location:'E.15.000',purposes:'Bunch for shipping',direction:'West to East',target_houses:'South house only',instructions:'Leave aisles at risers, remove drape. Red flags ship after Blue flags.',prerequisites:'Wait for hauling to finish before bunching.',house_sections:[{id:'north',name:'North House',direction:'East to West'},{id:'center',name:'Center House',direction:''}],source:[{unique_id:'fixture-lot',itemcode:'SYNTHETIC',commonname:'Royal Red butterfly bush',contsize:'#7',lotcode:'26.F1',salesyear:'2026',stock:0,review:0,available:null}],actions:[{id:'n',section_id:'north',margin_tag:'BOB',item_size:'#7',item_desc:'Royal Red butterfly bush',quantity_constraint:'< 30',instructions:'Haul to G15 S-HS. Keep Yellow Ribbon visible.',scope:'rows',row_ids:['fixture-lot']},{id:'c',section_id:'center',margin_tag:'QC',item_size:'3DP',item_desc:'Spacing work',quantity_constraint:'all',instructions:'Stop and pickup from E.23.000. Pink Ribbon stays attached.',scope:'location'}]};
const long={...short,note_number:'BN-SYNTHETIC-LONG',actions:Array.from({length:40},(_,i)=>({...short.actions[i%2],id:'line-'+i,section_id:i<20?'north':'center',margin_tag:i%3?'BUNCHERS':'CUSTOM NIGHT CREW',instructions:`Task ${i+1}: ${short.actions[i%2].instructions}\nCheck each original lot label. Keep road access clear; leave aisles at every riser.`,sequence_order:i+1}))};
const browser=await chromium.launch({headless:true});
try {
 for(const [name,report] of [['bunch-note-short',short],['bunch-note-multipage',long]]) {
  const html=context.buildBunchNotePdfHtml_(report);fs.writeFileSync(path.join(directory,name+'.html'),html);fs.writeFileSync(path.join(directory,name+'.json'),JSON.stringify(report));
  const page=await browser.newPage();await page.setContent(html);await page.pdf({path:path.join(directory,name+'.pdf'),preferCSSPageSize:true,printBackground:true});await page.close();
  console.log(path.join(directory,name+'.pdf'));
 }
} finally {await browser.close();}
