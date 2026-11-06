const CACHE = 'agdata-test:standalone-2.3.196';
const SHELL = ['./index.html','./manifest.json','./assets/test/config.js','./assets/test/isolation.js','./assets/test/operations.css','./assets/test/operations.mjs','./assets/test/operations-model.mjs','./assets/test/icon-192.png','./assets/test/icon-512.png'];
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(SHELL.map(url => new Request(url, { cache: 'reload' })));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const names = await caches.keys(); await Promise.all(names.filter(n => n.startsWith('agdata-test:standalone-') && n !== CACHE).map(n => caches.delete(n))); await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if(event.request.method==='GET' && url.hostname==='kzrnyjsosryejjejliii.supabase.co' && /^\/storage\/v1\/(object|render\/image)\/public\//.test(url.pathname)){
    const source=url.href.replace('/render/image/public/','/object/public/');
    event.respondWith(fetch('https://apztnscvagayslumnalr.supabase.co/functions/v1/test-photo-proxy?source='+encodeURIComponent(source)));return;
  }
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith('/test/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const saved=await cache.match(event.request,{ignoreSearch:true});
    const update=fetch(event.request).then(async response=>{if(response.ok)await cache.put(event.request,response.clone());return response;});
    if(saved){event.waitUntil(update.catch(()=>{}));return saved;}
    try{return await update;}
    catch{return (event.request.mode==='navigate'?await cache.match('./index.html'):undefined)||new Response('Test asset unavailable',{status:503});}
  })());
});
