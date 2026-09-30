(function(root){
 'use strict';
 const activationFor=(view,action)=>{
  if(action==='return openSalesOfficeView()')return()=>root.openSalesOfficeView();
  if(action==='return openInventoryOfficeView()')return()=>root.openInventoryOfficeView();
  return()=>root.switchView(view);
 };
 const card=(view,title,icon='ph-squares-four',action)=>Object.freeze({
  id:view,targetView:view,label:title,iconClass:icon,activate:activationFor(view,action),
  // Compatibility aliases remain until callers migrate to the shared descriptor names.
  view,title,icon,action:action||`return switchView('${view}')`
 });
 const common=[card('communication','Communication','ph-chat-circle-dots')];
 const registry={
  sales:[card('sales-office','Sales Office','ph-flower-lotus','return openSalesOfficeView()'),card('request-history','Request History','ph-clock-counter-clockwise'),card('sales-credit','Credit','ph-receipt'),card('credit-request','Credit Request','ph-check-square'),...common],
  'sales-inventory':[card('bunch-note','Bunch Notes','ph-notepad'),card('hl-order','HL Order','ph-truck'),...common],
  production:[card('docks','Docks','ph-truck'),card('drive','Drive Mode','ph-car'),card('moves','Inventory Office','ph-buildings','return openInventoryOfficeView()'),...common],
  qc:[card('moves','Inventory Office','ph-buildings','return openInventoryOfficeView()'),...common],
  office:common,
  managers:[card('reports','Reports','ph-chart-bar'),...common]
 };
 const hubs=Object.freeze(Object.fromEntries(Object.entries(registry).map(([view,items])=>[
  view,Object.freeze(items.map((item,order)=>Object.freeze({...item,hubView:view,order,displayOrder:order})))
 ])));
 const tileDescriptors=new WeakMap(),descriptorsByHub=new Map();
 const findTileIcon=(button)=>button.querySelector(':scope > i, :scope > svg, :scope > .premium-line-icon, i, svg, .premium-line-icon');
 const findTileLabel=(button)=>button.querySelector('.manager-module-title')||button.querySelector(':scope > div:nth-child(2) .text-lg, :scope > span, :scope > div:nth-child(2)');
 const slug=value=>String(value||'module').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'module';
 function inferHubView(grid){
  if(grid.id==='home-dashboard-grid')return'home';if(grid.id==='home-rep-dashboard-grid')return'home-rep';
  const idMatch=grid.id.match(/^(.*)-hub-grid$/);if(idMatch)return idMatch[1];
  return grid.closest('[id^="view-"]')?.id.replace(/^view-/,'')||'modules';
 }
 function inferTarget(button,hubView){
  const action=button.getAttribute('onclick')||'';
  const direct=action.match(/switchView\(\s*['"]([^'"]+)/)?.[1];if(direct)return direct;
  const tab=action.match(/setHomeTab\(\s*['"]([^'"]+)/)?.[1];if(tab)return hubView||tab;
  if(/openSalesOfficeView\s*\(/.test(action))return'sales-office';
  if(/openInventory(?:Hub|Office)View\s*\(/.test(action))return button.id==='home-tile-sales-inventory'?'sales-inventory':'moves';
  if(/openMovesView\s*\(/.test(action))return'moves';
  return button.dataset.homeModuleView||button.dataset.hubView||button.id.replace(/^home-tile-/,'')||hubView;
 }
 function descriptorForTile(button,item,hubView,order){
  if(item)return item;
  const existing=tileDescriptors.get(button);if(existing)return existing;
  const label=findTileLabel(button)?.textContent?.trim()||button.getAttribute('aria-label')||button.id||'Module';
  const targetView=inferTarget(button,hubView);
  const icon=findTileIcon(button),iconClass=[...(icon?.classList||[])].find(name=>/^ph-[a-z]/.test(name)&&!['ph-bold','ph-duotone','ph-fill','ph-light','ph-regular','ph-thin'].includes(name))||'';
  return Object.freeze({id:button.id||button.dataset.homeModuleView||button.dataset.hubView||`${hubView}-${slug(label)}-${order}`,targetView,label,iconClass,activate:()=>button.click(),hubView,order,displayOrder:order});
 }
 function registerDescriptor(button,descriptor){
  tileDescriptors.set(button,descriptor);
  const hub=descriptor.hubView||'modules';let entries=descriptorsByHub.get(hub);if(!entries){entries=new Map();descriptorsByHub.set(hub,entries);}
  entries.set(button.id||descriptor.id,descriptor);
 }
 function upgradeTile(button,item,context={}){
  if(!(button instanceof root.HTMLElement))return button;
  const descriptor=descriptorForTile(button,item,context.hubView||item?.hubView||'modules',context.order??item?.order??0);registerDescriptor(button,descriptor);
  button.classList.add('gnc-module-tile');
  const tileId=descriptor.id;
  if(tileId)button.dataset.moduleTileId=tileId;
  if(descriptor.targetView)button.dataset.moduleTargetView=descriptor.targetView;
  const icon=findTileIcon(button);if(icon)icon.classList.add('gnc-module-tile__icon');
  const label=findTileLabel(button);if(label)label.classList.add('gnc-module-tile__label');
  return button;
 }
 function createTile(hubView,item){
  const button=document.createElement('button');button.id='hub-extra-'+hubView+'-'+item.id;button.type='button';button.className='gnc-hub-card';button.dataset.hubView=item.targetView;
  const icon=document.createElement('i');icon.className='ph-bold '+item.iconClass;icon.setAttribute('aria-hidden','true');button.append(icon);
  const text=document.createElement('span');text.textContent=item.label;button.append(text);
  button.setAttribute('onclick',item.action);return upgradeTile(button,item,{hubView,order:item.order});
 }
 function upgradeGridTiles(grid,hubView=inferHubView(grid)){
  descriptorsByHub.set(hubView,new Map());
  [...grid.querySelectorAll(':scope > button, :scope > div')].forEach((tile,order)=>upgradeTile(tile,null,{hubView,order}));
 }
 function upgradeAllModuleTiles(){
  for(const grid of document.querySelectorAll('#home-dashboard-grid, #home-rep-dashboard-grid, [id$="hub-grid"], .manager-module-grid'))upgradeGridTiles(grid);
 }
 function syncHub(view){
  const parent=document.getElementById('view-'+view);if(!parent)return;
  const grid=parent.querySelector('[id$="hub-grid"]')||parent.querySelector('.manager-module-grid');if(!grid)return;
  upgradeGridTiles(grid,view);
  for(const item of hubs[view]||[]){
   const key='hub-extra-'+view+'-'+item.id;let button=document.getElementById(key);
   if(!button){
    const original=[...grid.querySelectorAll('button')].find(b=>(b.getAttribute('onclick')||'').includes(item.action.replace(/^return /,'')));
    if(original){upgradeTile(original,item);continue;}
    button=createTile(view,item);grid.append(button);
   }
   upgradeTile(button,item);
   const allowed=canAccessView(item.targetView);button.hidden=!allowed;button.classList.toggle('hidden',!allowed);
  }
 }
 let initialized=false,observedNav=null,footerResizeObserver=null,footerMeasureFrame=0;
 function scheduleFooterHeightMeasure(){
  if(footerMeasureFrame)return;
  const schedule=typeof root.requestAnimationFrame==='function'?root.requestAnimationFrame.bind(root):(callback)=>root.setTimeout(callback,0);
  footerMeasureFrame=schedule(()=>{
   footerMeasureFrame=0;
   const nav=observedNav;if(!nav)return;
   const height=Math.ceil(nav.getBoundingClientRect().height);if(!height)return;
   const value=height+'px',style=document.documentElement.style;
   if(style.getPropertyValue('--gnc-footer-height')!==value)style.setProperty('--gnc-footer-height',value);
  });
 }
 function shell(){
  const nav=document.getElementById('bottom-nav');
  if(!nav){footerResizeObserver?.disconnect();footerResizeObserver=null;observedNav=null;return;}
  if(nav!==observedNav){
   footerResizeObserver?.disconnect();observedNav=nav;
   footerResizeObserver=new root.ResizeObserver(scheduleFooterHeightMeasure);footerResizeObserver.observe(nav);
   scheduleFooterHeightMeasure();
  }
  upgradeAllModuleTiles();
  if(!initialized){initialized=true;document.documentElement.classList.add('gnc-mobile-workspace');}
 }
 const moduleRegistry=Object.freeze(Object.assign({
  descriptorFor:tile=>tileDescriptors.get(tile)||null,
  descriptorsForHub:view=>Object.freeze([...(descriptorsByHub.get(view)?.values()||[])].sort((a,b)=>a.displayOrder-b.displayOrder))
 },hubs));
 root.GncMobileWorkspace={syncHub,shell,hubs,registry:moduleRegistry,createTile,upgradeTile,upgradeAllModuleTiles};
})(typeof window==='undefined'?globalThis:window);
