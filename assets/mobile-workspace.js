(function(root){
 'use strict';
 const card=(view,title,icon='ph-squares-four',action)=>({view,title,icon,action});
 const common=[card('communication','Communication','ph-chat-circle-dots')];
 const hubs={
  sales:[card('sales-office','Sales Office','ph-flower-lotus','return openSalesOfficeView()'),card('request-history','Request History','ph-clock-counter-clockwise'),card('sales-credit','Credit','ph-receipt'),card('credit-request','Credit Request','ph-check-square'),...common],
  'sales-inventory':[card('bunch-note','Bunch Notes','ph-notepad'),card('hl-order','HL Order','ph-truck'),...common],
  production:[card('docks','Docks','ph-truck'),card('drive','Drive Mode','ph-car'),card('moves','Inventory Office','ph-buildings','return openInventoryOfficeView()'),...common],
  qc:[card('moves','Inventory Office','ph-buildings','return openInventoryOfficeView()'),...common],
  office:common,
  managers:[card('reports','Reports','ph-chart-bar'),...common]
 };
 function syncHub(view){
  const parent=document.getElementById('view-'+view);if(!parent)return;
  const grid=parent.querySelector('[id$="hub-grid"]')||parent.querySelector('.manager-module-grid');if(!grid)return;
  for(const item of hubs[view]||[]){
   const key='hub-extra-'+view+'-'+item.view;let button=document.getElementById(key);
   if(!button){
    const original=[...grid.querySelectorAll('button')].find(b=>(b.getAttribute('onclick')||'').includes(item.action?.replace(/^return /,'')||`switchView('${item.view}')`));
    if(original)continue;
    button=document.createElement('button');button.id=key;button.type='button';button.className='gnc-hub-card';button.dataset.hubView=item.view;
    const icon=document.createElement('i');icon.className='ph-bold '+item.icon;icon.setAttribute('aria-hidden','true');button.append(icon);
    const text=document.createElement('span');text.textContent=item.title;button.append(text);
    button.setAttribute('onclick',item.action||`return switchView('${item.view}')`);grid.append(button);
   }
   const allowed=canAccessView(item.view);button.hidden=!allowed;button.classList.toggle('hidden',!allowed);
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
  if(!initialized){initialized=true;document.documentElement.classList.add('gnc-mobile-workspace');}
 }
 root.GncMobileWorkspace={syncHub,shell,hubs};
})(typeof window==='undefined'?globalThis:window);
