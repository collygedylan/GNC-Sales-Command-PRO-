(function(root) {
 'use strict';
 const normalize = value => String(value ?? '').trim().toUpperCase();
 // Only a numeric third segment is a bay. Other codes retain their full identity.
 const base = value => normalize(value).replace(/^([A-Z0-9]+\.\d+)\.\d+$/, '$1');
 function group(values) {
  const groups = new Map();
  [...new Set(values.map(normalize).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).forEach(code=>{
   const key=base(code); if(!groups.has(key))groups.set(key,[]);groups.get(key).push(code);
  });
  return groups;
 }
 const views=new Map();
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const arg=value=>escape(JSON.stringify(value));
 function cards(key,entries,code,render) {
  const prior=views.get(key), groups=group(entries.map(code));
  const view={entries,code,render,selected:prior?.selected||'',scroll:prior?.scroll||0};
  if(!groups.has(view.selected))view.selected='';
  views.set(key,view);
  const html=view.selected?entries.filter(entry=>base(code(entry))===view.selected).map(render).join(''):[...groups].map(([name,codes])=>{
   if(codes.length===1&&codes[0]===name)return entries.filter(e=>normalize(code(e))===name).map(render).join('');
   return `<button type="button" class="location-base-card" onclick="LocationCode.open(${arg(key)},${arg(name)})" aria-label="Open location ${escape(name)}"><span><small>Location Code</small><strong>${escape(name)}</strong><span>${codes.length} full locations / bays</span></span><i class="ph-bold ph-caret-right" aria-hidden="true"></i></button>`;
  }).join('');
  return `<section data-location-navigation="${escape(key)}" data-location-bays="${view.selected?'true':'false'}">${html}</section>`;
 }
 function element(key) {return [...document.querySelectorAll('[data-location-navigation]')].find(el=>el.dataset.locationNavigation===key&&!el.closest('.hidden'));}
 function paint(key) {const v=views.get(key),el=element(key);if(v&&el)el.outerHTML=cards(key,v.entries,v.code,v.render);}
 function open(key,value) {const v=views.get(key);if(!v)return;v.scroll=typeof getMainAreaScrollTop==='function'?getMainAreaScrollTop():(root.scrollY||0);v.selected=value;paint(key);typeof setMainAreaScrollTop==='function'?setMainAreaScrollTop(0):root.scrollTo?.(0,0);}
 function back() {
  const el=[...document.querySelectorAll('[data-location-bays="true"]')].find(el=>!el.closest('.hidden')&&el.getClientRects().length);
  if(!el)return false;const key=el.dataset.locationNavigation,v=views.get(key);if(!v)return false;
  v.selected='';paint(key);typeof setMainAreaScrollTop==='function'?setMainAreaScrollTop(v.scroll):root.scrollTo?.(0,v.scroll);return true;
 }
 root.LocationCode={normalize,base,group,cards,open,back,reset:()=>views.clear()};
})(globalThis);
