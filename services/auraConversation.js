import { canonicalAuraSize } from '../utils/auraLingo.js';
export function createAuraConversation() {
  return { auraMode:'IDLE', party:null, lines:[], history:[], choice:null, resumeMode:null, consumedCommands:[], revision:0 };
}
export function acceptsAuraFollowUp(state) { return ['BUILDING_REQUEST','CHOOSING'].includes(state.auraMode); }
function lineKey(line) { return JSON.stringify([line.itemcode,canonicalAuraSize(line.contsize)]); }
/** I/O-free state; LINE_VERIFIED carries a freshly checked cumulative quantity. */
export function reduceAuraConversation(state,event) {
  if(event.commandId && state.consumedCommands.includes(event.commandId))return state;
  let next;
  switch(event.type) {
    case 'RESET': case 'CANCEL': case 'HANDED_OFF': next=createAuraConversation(); break;
    case 'STARTED':
      if(state.party||!event.party?.key||!event.party?.customerName) throw new Error('Resolve one customer and consignee before starting a new draft.');
      next={...state,auraMode:'BUILDING_REQUEST',party:{...event.party},choice:null,resumeMode:null}; break;
    case 'CHOICES':
      if(!Array.isArray(event.items)||!event.items.length||event.items.length>5)throw new Error('AURA requires one to five explicit choices.');
      next={...state,auraMode:'CHOOSING',resumeMode:state.auraMode==='CHOOSING'?state.resumeMode:state.auraMode,
        choice:{kind:event.kind,intent:event.intent,items:event.items.map(item=>({...item}))}}; break;
    case 'CHOICE_CANCELLED':
      next={...state,auraMode:state.party?'BUILDING_REQUEST':'IDLE',choice:null,resumeMode:null}; break;
    case 'LINE_VERIFIED': {
      if(!state.party||!acceptsAuraFollowUp(state))throw new Error('Start or resume a request first.');
      const line=event.line;
      if(!line?.unique_id||!line.itemcode||!line.contsize||!Number.isSafeInteger(line.quantity)||line.quantity<1||line.quantity>999999
        ||typeof line.ptravailable!=='number'||!Number.isFinite(line.ptravailable)||line.ptravailable<line.quantity)throw new Error('The selected lot has not verified the requested quantity.');
      const key=lineKey(line),existing=state.lines.findIndex(item=>lineKey(item)===key);
      if(existing<0&&state.lines.length>=50)throw new Error('Review this request before adding more than 50 items.');
      const lines=state.lines.map(item=>({...item}));
      if(existing<0)lines.push({...line});else lines[existing]={...line};
      next={...state,auraMode:'BUILDING_REQUEST',lines,history:[...state.history,state.lines].slice(-50),choice:null,resumeMode:null}; break;
    }
    case 'UNDO':
      if(!state.history.length)return state;
      if(!acceptsAuraFollowUp(state))throw new Error('Resume the request before changing it.');
      next={...state,auraMode:'BUILDING_REQUEST',lines:state.history.at(-1).map(line=>({...line})),history:state.history.slice(0,-1),choice:null,resumeMode:null}; break;
    case 'REVIEW':
      if(!state.party||!state.lines.length||state.auraMode!=='BUILDING_REQUEST')throw new Error('Add an item before opening review.');
      next={...state,auraMode:'REVIEWING_REQUEST'}; break;
    case 'REVIEW_FAILED':
      if(state.auraMode!=='REVIEWING_REQUEST')return state;
      next={...state,auraMode:'BUILDING_REQUEST'}; break;
    case 'PAUSE':
      if(state.auraMode==='IDLE'||state.auraMode==='PAUSED')return state;
      next={...state,auraMode:'PAUSED',resumeMode:state.auraMode==='REVIEWING_REQUEST'?'BUILDING_REQUEST':state.auraMode}; break;
    case 'RESUME':
      if(state.auraMode!=='PAUSED')return state;
      next={...state,auraMode:state.resumeMode??'BUILDING_REQUEST',resumeMode:null}; break;
    default:return state;
  }
  return {...next,revision:state.revision+1,consumedCommands:event.commandId?[...next.consumedCommands,event.commandId].slice(-256):next.consumedCommands};
}
