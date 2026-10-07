// @test-group: aura
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanseAuraInventoryText, parseAuraWholeNumber, canonicalAuraSize, readAuraProduct, matchAuraProduct } from '../utils/auraLingo.js';
import { parseAuraIntent } from '../utils/auraIntentParser.js';
import { createAuraConversation, acceptsAuraFollowUp, reduceAuraConversation } from '../services/auraConversation.js';

const catalog = { complete:true, rows:[
  {itemcode:'a',commonname:'Limelight Hydrangea',contsize:'3DP'},
  {itemcode:'b',commonname:'Little Hotties Hydrangea',contsize:'3DP'},
  {itemcode:'c',commonname:'Annabelle Hydrangea',contsize:'#3'},
]};
test('phonetic inventory normalization covers DP, gallon, hash, units and seasons',()=>{
  assert.equal(cleanseAuraInventoryText('three deep pee Limelight in you one'),'3DP Limelight in U1');
  assert.equal(cleanseAuraInventoryText('hash three Annabelle in you two'),'#3 Annabelle in U2');
  assert.equal(canonicalAuraSize('three gallon'),'#3');
  assert.equal(canonicalAuraSize('8 in.'),'8 IN');
  assert.equal(readAuraProduct('3DP Limelight').commonName,'Limelight');
  assert.equal(readAuraProduct('#3 #5 Annabelle'),null);
});
test('whole quantities support hundreds and thousands without accepting malformed sequences',()=>{
  for(const [input,number] of [['zero',0],['one hundred and fifty',150],['two thousand three hundred and one',2301],['1,250',1250],['ninety-nine',99]]) assert.equal(parseAuraWholeNumber(input),number,input);
  for(const input of ['','one two','hundred','two hundred hundred','one and','one thousand and','3.5','-10','1000000','one thousand one thousand']) assert.equal(parseAuraWholeNumber(input),null,input);
});
test('draft quantity is parsed before size cleansing and only in an active draft',()=>{
  for(const [text,quantity,size] of [['fifty three gallon Limelight',50,'#3'],['fifty-three 3DP Limelight',53,'3DP'],['add one hundred and fifty three deep pee Limelight',150,'3DP'],['3DP Limelight quantity fifty',50,'3DP']]) {
    const intent=parseAuraIntent(text,{auraMode:'BUILDING_REQUEST'});
    assert.equal(intent.type,'ADD_REQUEST_ITEM',text); assert.equal(intent.quantity,quantity,text); assert.equal(intent.contSize,size,text);
  }
  assert.equal(parseAuraIntent('50 3DP Limelight').type,'unknown');
  assert.equal(parseAuraIntent('zero 3DP Limelight',{auraMode:'BUILDING_REQUEST'}).type,'unknown');
});
test('parser preserves customer and chat phrases while inventory scopes are normalized',()=>{
  assert.equal(parseAuraIntent('Start a request for You One Nursery').customerName,'You One Nursery');
  const chat=parseAuraIntent('send a message to You One saying three deep pee');
  assert.equal(chat.recipientName,'You One');assert.equal(chat.message,'three deep pee');
  const count=parseAuraIntent('Hey Aura, how many three deep pee Little Hotties in you two at A.07.000');
  assert.equal(count.type,'CHECK_INVENTORY_COUNT'); assert.equal(count.season,'U2'); assert.equal(count.locationCode,'A.07.000'); assert.equal(count.commonName,'Little Hotties');
  const scout=parseAuraIntent('we have you one disease on Annabelle three gallon at A.07.000');
  assert.equal(scout.type,'scout'); assert.equal(scout.pestCode,'you one disease');
});
test('maximum queries use fixed numeric metrics and reject mixed or arbitrary columns',()=>{
  assert.deepEqual(parseAuraIntent('What item has the largest U1 value'),{type:'CHECK_INVENTORY_MAX',metric:'ptravailable',openStockOnly:false,season:'U1',locationCode:null});
  assert.equal(parseAuraIntent('largest on-hand value in U2').metric,'ptronhand');
  assert.equal(parseAuraIntent('largest priority in U1').type,'unknown');
  assert.equal(parseAuraIntent('largest U1 U2 value').type,'unknown');
  assert.equal(parseAuraIntent('largest available on-hand value in U2').type,'unknown');
  assert.equal(parseAuraIntent('largest U3 value').season,'U3');
  assert.equal(parseAuraIntent('largest value in season X').season,'X');
  assert.equal(parseAuraIntent('largest F2 value').type,'unknown');
  assert.equal(parseAuraIntent('how many #3 Abelia x grandiflora').commonName,'Abelia x grandiflora');
  assert.equal(parseAuraIntent('how many #3 Annabelle do we have in open stock').openStockOnly,true);
});
test('numbered choices only resolve in CHOOSING mode',()=>{
  assert.deepEqual(parseAuraIntent('option two',{auraMode:'CHOOSING'}),{type:'CHOOSE_MATCH',index:1});
  assert.equal(parseAuraIntent('two').type,'unknown');
  assert.equal(parseAuraIntent('six',{auraMode:'CHOOSING'}).type,'unknown');
});
test('matching groups repeated locations by SKU, keeps sizes exact and returns ambiguity',()=>{
  assert.equal(matchAuraProduct({commonName:'Limelight',contSize:'three deep pee'},catalog).kind,'match');
  assert.equal(matchAuraProduct({commonName:'Limelight',contSize:'#3'},catalog).kind,'none');
  const repeated={complete:true,rows:[catalog.rows[0],{...catalog.rows[0]}]};
  assert.equal(matchAuraProduct({commonName:'Limelight',contSize:'3DP'},repeated).kind,'match');
  const ambiguous={complete:true,rows:[catalog.rows[0],{...catalog.rows[0],itemcode:'different'}]};
  assert.equal(matchAuraProduct({commonName:'Limelight',contSize:'3DP'},ambiguous).kind,'choose');
  assert.throws(()=>matchAuraProduct({commonName:'Limelight'}, {complete:false,rows:catalog.rows}),/complete/);
});
test('fuzzy name comparisons preserve cultivar numbers and demand exact short names',()=>{
  assert.equal(matchAuraProduct({commonName:'Limeligh',contSize:'3DP'},catalog).kind,'choose');
  const rows=[{itemcode:'20',commonname:'20th Century Pear',contsize:'#3'},{itemcode:'21',commonname:'21st Century Pear',contsize:'#3'},{itemcode:'short',commonname:'Oak',contsize:'#3'}];
  assert.equal(matchAuraProduct({commonName:'20th Century Pear',contSize:'#3'},{complete:true,rows}).item.itemcode,'20');
  assert.equal(matchAuraProduct({commonName:'Oa',contSize:'#3'},{complete:true,rows}).kind,'none');
});
const party={key:'customer|||consignee',customerName:'Customer',consigneeName:'Consignee'};
const line={unique_id:'lot1',itemcode:'a',commonname:'Limelight',contsize:'3DP',ptravailable:100,quantity:30};
const started=()=>reduceAuraConversation(createAuraConversation(),{type:'STARTED',party});
test('verified cumulative additions replace one SKU and Undo restores the earlier total',()=>{
  let state=reduceAuraConversation(started(),{type:'LINE_VERIFIED',line,commandId:'one'});
  const unchanged=reduceAuraConversation(state,{type:'LINE_VERIFIED',line,commandId:'one'});
  assert.equal(unchanged,state);
  state=reduceAuraConversation(state,{type:'LINE_VERIFIED',line:{...line,unique_id:'lot2',quantity:70},commandId:'two'});
  assert.equal(state.lines.length,1); assert.equal(state.lines[0].quantity,70);
  state=reduceAuraConversation(state,{type:'UNDO'});
  assert.equal(state.lines[0].quantity,30);assert.equal(state.lines[0].unique_id,'lot1');
});
test('conversation refuses unknown quantities, silent draft replacement and additions before customer resolution',()=>{
  assert.throws(()=>reduceAuraConversation(started(),{type:'STARTED',party}),/Resolve/);
  assert.throws(()=>reduceAuraConversation(createAuraConversation(),{type:'LINE_VERIFIED',line}),/Start/);
  for(const ptravailable of [null,undefined,'',NaN,29]) assert.throws(()=>reduceAuraConversation(started(),{type:'LINE_VERIFIED',line:{...line,ptravailable}}),/verified/);
});
test('pause, choices, review failure, handoff and cancellation preserve the correct draft lifecycle',()=>{
  let state=reduceAuraConversation(started(),{type:'LINE_VERIFIED',line});
  state=reduceAuraConversation(state,{type:'CHOICES',kind:'item',intent:{type:'ADD_REQUEST_ITEM'},items:[catalog.rows[0]]});
  assert.equal(acceptsAuraFollowUp(state),true);
  state=reduceAuraConversation(state,{type:'PAUSE'});assert.equal(acceptsAuraFollowUp(state),false);
  state=reduceAuraConversation(state,{type:'RESUME'});assert.equal(state.auraMode,'CHOOSING');
  state=reduceAuraConversation(state,{type:'CHOICE_CANCELLED'});
  state=reduceAuraConversation(state,{type:'REVIEW'});assert.equal(state.auraMode,'REVIEWING_REQUEST');
  state=reduceAuraConversation(state,{type:'REVIEW_FAILED'});assert.equal(state.lines.length,1);
  state=reduceAuraConversation(state,{type:'HANDED_OFF'});assert.equal(state.lines.length,0);
  assert.equal(state.auraMode,'IDLE');
});
test('drafts are limited to 50 distinct SKU lines',()=>{
  let state=started();
  for(let i=0;i<50;i++)state=reduceAuraConversation(state,{type:'LINE_VERIFIED',line:{...line,itemcode:String(i),unique_id:String(i)}});
  assert.throws(()=>reduceAuraConversation(state,{type:'LINE_VERIFIED',line:{...line,itemcode:'51'}}),/50/);
});

test('Baby Gem inventory grammar strips the question verb without touching customer or chat text', () => {
  const intent = parseAuraIntent('How many 3DP baby gem boxwood are in open stock');
  assert.equal(intent.commonName, 'baby gem boxwood'); assert.equal(intent.contSize, '3DP'); assert.equal(intent.openStockOnly, true);
  assert.equal(parseAuraIntent('How many 3DP Baby Gem® Boxwood are in U2').commonName, 'Baby Gem® Boxwood');
  assert.equal(parseAuraIntent('Start a request for We Are In Stock').customerName, 'We Are In Stock');
  assert.equal(parseAuraIntent('send a message to Megan saying We are in open stock').message, 'We are in open stock');
});
