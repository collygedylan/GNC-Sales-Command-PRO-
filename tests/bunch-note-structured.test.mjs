import { assertHistoricalMigration } from './helpers/ci-discovery.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { normalizeNote, orderNote, moveLine, moveEntry, freeformLine, operationalTokens, crewTags } from '../components/bunch-notes/model.mjs';
const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
export const structuredFixture = () => ({ location:'E.15.000', note_number:'BN-QA', instruction_revision:2,
  purposes:'Bunch and prepare for shipping', direction:'West to East', target_houses:'South house only',
  instructions:'Leave aisles at risers, remove drape. Red flags and Blue flags.', prerequisites:'Wait for hauling',
  house_sections:[{id:'north',name:'North House',direction:'East to West'},{id:'center',name:'Center House',direction:''}],
  source:[{unique_id:'lot',commonname:'Royal Red butterfly bush',contsize:'#7',stock:0,review:0,available:null}],
  actions:[{...freeformLine('c','center'),margin_tag:'CUSTOM CREW',item_size:'3DP',item_desc:'Spacing work',quantity_constraint:'all',instructions:'Stop and pickup from E.23.000. Pink Ribbon'},
    {...freeformLine('n','north'),margin_tag:'BOB',quantity_constraint:'< 30',instructions:'Haul to G15 S-HS. Yellow Ribbon'}] });

test('sections order lines, preserve exact quantity instructions, and support custom tags',()=>{
 const n=normalizeNote(structuredFixture());
 assert.deepEqual(n.actions.map(a=>[a.id,a.sequence_order,a.sub_location]),[['n',1,'North House'],['c',2,'Center House']]);
 assert.equal(n.actions[0].quantity_constraint,'< 30');assert.equal(n.actions[1].margin_tag,'CUSTOM CREW');
 assert.equal(orderNote({...n,house_sections:moveEntry(n.house_sections,'center',-1)}).actions[0].id,'c');
 assert.equal(n.actions[0].id,'n','reordering never mutates the prior draft');
 assert.equal(normalizeNote({actions:[{id:'zero',quantity:0}],house_sections:[]}).actions[0].quantity_constraint,'0');
 assert.equal(crewTags.length,8);
});
test('line moves stay within houses and inventory links survive normalization',()=>{
 const n=normalizeNote({...structuredFixture(),actions:[{...freeformLine('a','north'),instructions:'A'},
 {...freeformLine('b','north'),instructions:'B'},{id:'linked',scope:'rows',row_ids:['lot'],instructions:'Move',kind:'move',destination:'G.15.000'}]});
 const moved=moveLine(n,'b',-1);
 assert.deepEqual(moved.actions.map(a=>a.id),['linked','b','a']);
 assert.deepEqual(moved.actions[0].row_ids,['lot']);assert.equal(moved.actions[0].item_size,'#7');
 assert.equal(moved.actions[0].destination,'G.15.000');
 assert.deepEqual(moveLine(moved,'b',-1),moved);
});
test('keyword parser is case insensitive, preserves text, and never creates HTML',()=>{
 const input='<script>Red flags</script> BLUE FLAG, Pink Ribbon, yellow ribbons; infrared flags';
 const tokens=operationalTokens(input);
 assert.equal(tokens.map(x=>x.text).join(''),input);
 assert.deepEqual(tokens.filter(x=>x.color).map(x=>x.color),['red','blue','pink','yellow']);
});

const require=createRequire(import.meta.url);
const built=await build({entryPoints:[new URL('../components/bunch-notes/StructuredBunchNote.jsx',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic'});
const componentModule={exports:{}};
vm.runInNewContext(built.outputFiles[0].text,{require,module:componentModule,exports:componentModule.exports,crypto:globalThis.crypto,console});
const { StructuredBunchNote }=componentModule.exports;
const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
test('React worksheet renders directions, routing, accessible crew text, and escaped markup',()=>{
 const value=structuredFixture();value.actions[0].instructions+='<img src=x onerror=evil()>';
 const html=renderToStaticMarkup(React.createElement(StructuredBunchNote,{value,mode:'read',progress:{n:{status:'done'}}}));
 for(const expected of ['South house only','West to East','East to West','BOB','CUSTOM CREW','&lt; 30','Stop and pickup','Pink Ribbon','Done'])assert.ok(html.includes(expected),expected);
 assert.ok(html.indexOf('North House')<html.indexOf('Center House'));
 assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));
});
test('React editor change callbacks keep fields, sections, and stable action IDs',()=>{
 const value=normalizeNote(structuredFixture()),changes=[];
 const tree=StructuredBunchNote({value,mode:'edit',onChange:n=>changes.push(n),onDetails(){}});
 const elements=[];
 function visit(el){if(!el||typeof el!=='object')return;if(Array.isArray(el)){el.forEach(visit);return;}elements.push(el);visit(el.props?.children);}
 visit(tree);
 const constraint=elements.find(el=>el.props?.label==='Quantity constraint'&&el.props.value==='< 30');
 constraint.props.onChange('all');
 assert.equal(changes.at(-1).actions[0].quantity_constraint,'all');assert.equal(value.actions[0].quantity_constraint,'< 30');
 const add=elements.find(el=>el.type==='button'&&el.props.children==='Add house section');add.props.onClick();
 assert.equal(changes.at(-1).house_sections.length,3);
 assert.deepEqual(plain(changes.at(-1).actions.map(a=>a.id)),['n','c']);
});
function pdf(report) {
 const gas=read('Code.gs'),ctx=vm.createContext({escapeEmailHtml_:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')});
 vm.runInContext(gas.slice(gas.indexOf('function buildBunchNotePdfHtml_'),gas.indexOf('function handleBunchNotePreview_')),ctx);
 return ctx.buildBunchNotePdfHtml_(report);
}
test('PDF uses identical house order, directions, quantity text, and colors before source detail',()=>{
 const html=pdf(structuredFixture());
 for(const value of ['South house only','North House · East to West','Center House · West to East','CUSTOM CREW','&lt; 30','Haul to G15 S-HS','#fee2e2','#dbeafe','#fce7f3','#fef9c3','On Hand 0'])assert.ok(html.includes(value),value);
 assert.ok(html.indexOf('General instructions')<html.indexOf('North House'));
 assert.ok(html.indexOf('North House')<html.indexOf('Center House'));
 assert.ok(html.indexOf('Center House')<html.indexOf('Plant details'));
 assert.ok(!pdf({...structuredFixture(),instructions:'<script>bad</script>'}).includes('<script>'));
});
test('structured storage stays private and participates in guarded cloud migration delivery',()=>{
 const name='20261005225759_structured_bunch_notes.sql',sql=read('supabase/migrations/'+name);
 for(const table of ['bunch_notes','bunch_note_lines'])assert.ok(sql.includes(`alter table bunch_note_private.${table} enable row level security`));
 assert.match(sql,/from public,anon,authenticated,service_role/);
 assert.match(sql,/unique\(bunch_note_id,sequence_order\) deferrable initially deferred/);
 assert.match(sql,/p_command_id is null/);assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/job\.revision is distinct from p_expected_revision/);
 assert.ok(read('scripts/apply-item-low-stock-migration.mjs').includes(name));
 assertHistoricalMigration(name);
 assert.match(read('assets/bunch-note.js'),/Your edits are still here/);
 assert.match(read('assets/bunch-note.js'),/generation!==structuredGeneration/);
});
