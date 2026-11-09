import { tokenizer } from 'acorn';

// One lexical pass: comments and strings cannot masquerade as executable routes.
export function inspectProgram(source) {
  const comments = [], functions = new Map(), calls = [];
  const tokens = tokenizer(source, {ecmaVersion:'latest', allowHashBang:true,
    onComment:(_block,_text,start,end)=>comments.push([start,end])});
  const callStack=[];
  let braces=0, parens=0, brackets=0, pending=null, owner=null, prev=null, prev2=null, prev3=null, firstArgument=null;
  for (;;) {
    const token=tokens.getToken(), label=token.type.label;
    if (label==='eof') break;
    const activeCall=callStack.at(-1);
    if(activeCall && activeCall.argumentEnd==null && parens===activeCall.depth && braces===activeCall.braces && brackets===activeCall.brackets && (label===','||label===')')) {
      activeCall.argumentEnd=token.start;activeCall.firstArgumentSource=source.slice(activeCall.argumentStart,token.start);
    }
    if (firstArgument) { firstArgument.firstArgument=label==='string'?token.value:null; firstArgument=null; }
    if (label==='function' && braces===0 && parens===0 && brackets===0 && prev?.type.label!=='=') {
      pending={name:null,start:prev?.value==='async'?prev.start:token.start};
    } else if (pending && !pending.name && label==='name') pending.name=token.value;
    if (label==='(') {
      const name=prev?.type.label==='name'?prev.value:prev?.type.label===']'&&prev2?.type.label==='string'&&prev3?.type.label==='['?prev2.value:null;
      if(name && prev2?.type.label!=='function' && prev2?.type.label!=='*') {
        const call={name,owner:owner?.name||'<top>',start:prev.start,firstArgument:null,argumentStart:token.end,argumentEnd:null,depth:parens+1,braces,brackets,insidePublisher:callStack.some(parent=>parent.name==='publishRowEvaluationToMasterAndNotes')};
        calls.push(call); owner?.calls.push(call); firstArgument=call;
        callStack.push(call);
      }
      parens++;
    } else if(label===')') { if(callStack.at(-1)?.depth===parens){const closed=callStack.pop();closed.end=token.end;closed.source=source.slice(closed.start,closed.end);}parens--; }
    else if(label==='[') brackets++;
    else if(label===']') brackets--;
    if(label==='{' || label==='${') {
      if(pending?.name && braces===0 && parens===0 && brackets===0) {
        owner={...pending,calls:[],literals:[]}; pending=null;
      }
      braces++;
    } else if(label==='}') {
      braces--;
      if(owner && braces===0) {
        owner.end=token.end; owner.source=source.slice(owner.start,owner.end);
        const matches=functions.get(owner.name)||[];matches.push(owner);functions.set(owner.name,matches);owner=null;
      }
    }
    if(owner && (label==='string'||label==='template')) owner.literals.push(String(token.value||''));
    prev3=prev2;prev2=prev;prev=token;
  }
  const parts=[];let offset=0;
  for(const [start,end] of comments){parts.push(source.slice(offset,start),' ');offset=end;}
  parts.push(source.slice(offset));
  return {functions,calls,code:parts.join('')};
}

export function reaches(program, start, target, visited=new Set()) {
  if(start===target)return program.functions.has(target);
  if(visited.has(start))return false;visited.add(start);
  return (program.functions.get(start)||[]).some(fn=>fn.calls.some(call=>call.name===target||reaches(program,call.name,target,visited)));
}

export function canonicalEngineFailures(program, contracts) {
  const errors=[];
  for(const name of contracts.engines)if(program.functions.get(name)?.length!==1)errors.push('exactly one canonical '+name+' is required');
  for(const [caller,target] of contracts.routes)if(!reaches(program,caller,target))errors.push(caller+' bypasses '+target);
  for(const [name,allowedOwners] of Object.entries(contracts.transports||{}))for(const call of program.calls) {
    if(call.name===name && !allowedOwners.includes(call.owner))errors.push(call.owner+' bypasses canonical publication via '+name);
  }
  for(const call of program.calls)if(call.name==='runSuspendTagRowCommand'&&call.owner!=='publishRowEvaluationToMasterAndNotes') {
    if(call.firstArgument==='save'||/['"]save['"]/.test(call.firstArgumentSource||''))errors.push(call.owner+' bypasses canonical Suspend save');
    else if(call.firstArgument==null && contracts.dynamicSuspendOwners && !contracts.dynamicSuspendOwners.includes(call.owner))errors.push(call.owner+' bypasses audited Suspend lifecycle');
    else if(call.firstArgument!=null && contracts.suspendOwners?.[call.firstArgument] && !contracts.suspendOwners[call.firstArgument].includes(call.owner))errors.push(call.owner+' bypasses audited Suspend '+call.firstArgument);
  }
  for(const call of program.calls)if(call.name==='supabaseRpc'&&contracts.rpcOwners?.[call.firstArgument]) {
    if(!contracts.rpcOwners[call.firstArgument].includes(call.owner))errors.push(call.owner+' bypasses canonical RPC '+call.firstArgument);
    if(call.firstArgument==='save_request_work' && !call.insidePublisher)errors.push(call.owner+' invokes Request persistence outside canonical publication');
  }
  for(const call of program.calls) {
    if(contracts.rawMasterOwners && ['runDetailWriteWithRetry','supabaseFetch'].includes(call.name) && call.firstArgument==='ph_master_inventory' && /['"](?:PATCH|POST|PUT|DELETE)['"]/.test(call.source||'') && !contracts.rawMasterOwners.includes(call.owner))errors.push(call.owner+' bypasses audited master publication');
    if(call.name==='seasonSalesOfficeApi' && call.firstArgument==='save_av_note' && (!contracts.seasonSaveOwners?.includes(call.owner)||!call.insidePublisher))errors.push(call.owner+' bypasses canonical Season AV-note publication');
    if(call.name==='postAppFunctionJson' && call.firstArgument==='request_work' && /['"]append_photo['"]/.test(call.source||'') && (!contracts.requestPhotoOwners?.includes(call.owner)||!call.insidePublisher))errors.push(call.owner+' bypasses canonical Request photo publication');
  }
  for(const name of contracts.reportRenderers||[])for(const fn of program.functions.get(name)||[]) {
    const markup=fn.literals.join('').replace(/&(?:gt|#62|#x3e);/gi,'>').replace(/&(?:larr|#8592|#x2190);/gi,'←').replace(/\s+/g,' ');
    if(/←\s*All reports|EVAL REPORTS #2\s*>/i.test(markup))errors.push(name+' restores redundant report navigation');
    if(/All reports/i.test(markup)&&/showEvalAggregateDashboard/.test(markup))errors.push(name+' restores inline report Back');
    for(const summary of markup.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/gi))if(/(?:^|\s)(?:Reports\s*:|Filters)(?:\s|$)/i.test(summary[1].replace(/<[^>]*>/g,' ')))errors.push(name+' restores Reports/Filters accordion');
  }
  return errors;
}

export function forbiddenAssetText(source) {
  const normalized = source.toLowerCase();
  return ['Request Still Open','Take or upload at least one request photo','APPROVED BUNCH NOTE:'].filter(text=>normalized.includes(text.toLowerCase()));
}

export function liveAssetVersionFailures(html, expected) {
  const errors = [];
  const attr = (tag, key) => tag.match(new RegExp('\\b' + key + '\\s*=\\s*(["\\\'])(.*?)\\1', 'i'))?.[2];
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) || []) {
    const script = /^<script\b/i.test(tag);
    if (!script && !String(attr(tag, 'rel') || '').toLowerCase().split(/\s+/).includes('stylesheet')) continue;
    const value = attr(tag, script ? 'src' : 'href');
    if (!value || /^(?:data:|blob:)/i.test(value)) continue;
    let url;
    try { url = new URL(value.replace(/&amp;/g, '&'), 'https://agdata.invalid/'); }
    catch (_) { errors.push('invalid local asset URL'); continue; }
    if (url.origin !== 'https://agdata.invalid') continue;
    if (url.searchParams.getAll('v').length !== 1 || url.searchParams.get('v') !== expected) errors.push('asset version mismatch: ' + url.pathname);
  }
  return errors;
}
