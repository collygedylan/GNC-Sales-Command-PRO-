(function () {
  'use strict';
  const PROJECT = 'apztnscvagayslumnalr';
  const PREFIX = 'agdata-test:';
  const config = window.AGDATA_TEST_CONFIG;
  if (!config || config.project !== PROJECT) throw new Error('TEST_CONFIG_REQUIRED');
  const logical = config.names;
  const resolveName = name => {
    if (String(name).startsWith('test_')) return name;
    if (logical[name]) return logical[name];
    throw new Error('UNMAPPED_TEST_DATABASE_OBJECT:' + name);
  };

  const reverseNames = Object.fromEntries(Object.entries(logical).map(([key,value])=>[value,key]));
  const namespaceFields = /^(?:p_)?(?:key|keys|source_key|source_keys|canonical_keys|source_table|table|table_name|relation|relation_name|target_table)$/i;
  function namespaceId(value,reverse=false) {
    const map=reverse?reverseNames:logical;if(map[value])return map[value];
    if(value.startsWith('public.'))return 'public.'+(map[value.slice(7)]||value.slice(7));
    const match=/^(test_)?(private|bloomscapes_private|hl_order_private|sales_private|aura_private|labor_internal|import_private|suspend_tag_private|app_sync_private|bunch_note_private|workflow_private)\.(.+)$/.exec(value);
    return match?(reverse?'':'test_')+match[2]+'.'+match[3]:value;
  }
  function namespaceData(value,reverse=false,field='') {
    if(typeof value==='string')return namespaceFields.test(field)?namespaceId(value,reverse):value;
    if(Array.isArray(value))return value.map(v=>namespaceData(v,reverse,field));
    if(value&&typeof value==='object'){const result={};for(const [key,v] of Object.entries(value))result[namespaceId(key,reverse)]=namespaceData(v,reverse,key);return result;}
    return value;
  }
  function namespaceQuery(url) {
    const select=url.searchParams.get('select');if(select)url.searchParams.set('select',select.replace(/\b([A-Za-z_][\w]*)(?=\s*(?:!|\())/g,(name,offset,text)=>logical[name]?(text[offset-1]===':'?'':name+':')+logical[name]:name));
    for(const [key,value] of [...url.searchParams])if(namespaceFields.test(key))url.searchParams.set(key,value.replace(/(?<![A-Za-z_])(?:public\.)?(?:[A-Za-z_][\w]*_private\.)?[A-Za-z_][\w]*/g,name=>namespaceId(name)));
  }

  function storageRoute(url,body) {
    if(!url.pathname.startsWith('/storage/v1/object/'))return body;
    const parts=url.pathname.split('/'),mode=parts[4];let value;
    try{value=typeof body==='string'?JSON.parse(body):null;}catch{value=null;}
    if(['move','copy'].includes(mode)){
      if(value?.bucketId&&value.bucketId!=='farm-operations-staging'){const old=value.bucketId;value.bucketId='farm-operations-staging';for(const key of ['sourceKey','destinationKey'])if(typeof value[key]==='string')value[key]=old+'/'+value[key];}
    }else{
      const i=['list','public','sign','authenticated','upload','info'].includes(mode)?5:4,old=parts[i];
      if(old&&old!=='farm-operations-staging'){
        parts[i]='farm-operations-staging';
        if(mode==='list'&&value)value.prefix=old+'/'+(value.prefix||'');
        else if(parts.length===i+1&&value){for(const key of ['prefixes','paths'])if(Array.isArray(value[key]))value[key]=value[key].map(p=>old+'/'+p);}
        else parts.splice(i+1,0,old);
        url.pathname=parts.join('/');
      }
    }
    return value?JSON.stringify(value):body;
  }
  function scopedStorage(original) {
    const keys = () => Array.from({ length: original.length }, (_, i) => original.key(i)).filter(k => k?.startsWith(PREFIX));
    return new Proxy({}, { get(_target, key) {
      if (key === 'getItem') return k => original.getItem(PREFIX + k);
      if (key === 'setItem') return (k, v) => original.setItem(PREFIX + k, v);
      if (key === 'removeItem') return k => original.removeItem(PREFIX + k);
      if (key === 'clear') return () => keys().forEach(k => original.removeItem(k));
      if (key === 'key') return i => keys()[i]?.slice(PREFIX.length) ?? null;
      if (key === 'length') return keys().length;
      if (typeof key === 'string') return original.getItem(PREFIX + key);
      return undefined;
    }, set(_target, key, value) { original.setItem(PREFIX + String(key), value); return true; }, ownKeys: () => keys().map(k => k.slice(PREFIX.length)), getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });
  }
  for (const name of ['localStorage', 'sessionStorage']) {
    const original = window[name];
    Object.defineProperty(window, name, { configurable: true, get: () => scopedStorage(original) });
  }
  for (const method of ['open','deleteDatabase']) {
    const original = indexedDB[method].bind(indexedDB);
    indexedDB[method] = (name, ...args) => original(PREFIX + name, ...args);
  }
  if (window.BroadcastChannel) {
    const Native = window.BroadcastChannel;
    window.BroadcastChannel = class extends Native { constructor(name) { super(PREFIX + name); } };
  }
  const cacheStore = window.caches;
  if (cacheStore) {
    Object.defineProperty(window, 'caches', { configurable: true, value: {
      open: name => cacheStore.open(PREFIX + name),
      has: name => cacheStore.has(PREFIX + name),
      delete: name => cacheStore.delete(PREFIX + name),
      keys: async () => (await cacheStore.keys()).filter(k => k.startsWith(PREFIX)).map(k => k.slice(PREFIX.length)),
      match: async (request, options) => { for (const name of await cacheStore.keys()) if (name.startsWith(PREFIX)) { const response = await (await cacheStore.open(name)).match(request, options); if (response) return response; } }
    }});
  }
  const originalJson = Response.prototype.json;
  const originalText = Response.prototype.text;
  const mediaPattern = /https:\/\/kzrnyjsosryejjejliii\.supabase\.co\/storage\/v1\/(?:object\/public|render\/image\/public)\/[^\s"<>\\\]\},]+/g;
  function mapMedia(value) {
    if (typeof value === 'string') return value.replace(mediaPattern, source => PROJECT_URL + '/functions/v1/test-photo-proxy?source=' + encodeURIComponent(source.replace('/render/image/public/', '/object/public/')));
    if (Array.isArray(value)) { for (let i=0;i<value.length;i++) value[i]=mapMedia(value[i]); }
    else if (value && typeof value === 'object') for (const key of Object.keys(value)) value[key]=mapMedia(value[key]);
    return value;
  }
  const PROJECT_URL = 'https://' + PROJECT + '.supabase.co';
  Response.prototype.json = async function () { const data=await originalJson.call(this); return this.url?.startsWith(PROJECT_URL+'/rest/v1/') || this.url?.startsWith(PROJECT_URL+'/functions/v1/') ? mapMedia(namespaceData(data,true)) : data; };
  Response.prototype.text = async function () { const data=await originalText.call(this);return this.url?.startsWith(PROJECT_URL+'/rest/v1/') || this.url?.startsWith(PROJECT_URL+'/functions/v1/') ? mapMedia(data) : data; };
  window.addEventListener('error', event => { const img=event.target;if(!(img instanceof HTMLImageElement)||!img.src.includes('/functions/v1/test-photo-proxy?'))return;const attempts=Number(img.dataset.testImageRetries||0);if(attempts>=3)return;event.stopImmediatePropagation();img.dataset.testImageRetries=String(attempts+1);setTimeout(()=>{const url=new URL(img.src);url.searchParams.set('retry',String(attempts+1));img.src=url.href;},400*(attempts+1)); }, true);
  function restoreStagedMedia(body) {
    return body.replace(/https:\/\/apztnscvagayslumnalr\.supabase\.co\/functions\/v1\/test-photo-proxy\?source=([^"\s<>]+)/g, (_match, encoded) => {
      try { const source=new URL(decodeURIComponent(encoded)); return PROJECT_URL+'/storage/v1/object/public/farm-operations-staging/'+source.pathname.split('/object/public/')[1]; } catch { return _match; }
    });
  }
  const nativeFetch = window.fetch.bind(window);
  function rewriteUrl(input) {
    const url = new URL(input, location.href);
    if (url.hostname.endsWith('.supabase.co') && url.hostname !== PROJECT + '.supabase.co') throw Error('PRODUCTION_NETWORK_BLOCKED');
    if (url.hostname === PROJECT + '.supabase.co') {
      namespaceQuery(url);
      const match = /^\/rest\/v1\/(rpc\/)?([^/]+)(.*)$/.exec(url.pathname);
      if (match) url.pathname = '/rest/v1/' + (match[1] || '') + resolveName(decodeURIComponent(match[2])) + match[3];
      url.pathname = url.pathname.replace(/^\/functions\/v1\/(?!test-)([^/]+)/, '/functions/v1/test-$1');
      if (/\/auth\/v1\/(recover|resend|signup|otp|invite|authorize)/.test(url.pathname)) throw Error('TEST_EXTERNAL_IDENTITY_DELIVERY_DISABLED');
      storageRoute(url);
    }
    if (url.origin === location.origin && !url.pathname.startsWith('/test/') && (url.pathname === '/version.json' || url.pathname === '/deployment.json' || /^\/(assets|services|reports|utils|components)\//.test(url.pathname))) url.pathname = '/test' + url.pathname;
    return url;
  }
  window.fetch = async (input, init = {}) => {
    const request = input instanceof Request ? input : null;
    const originalUrl=new URL(request?request.url:String(input),location.href);
    const url = rewriteUrl(originalUrl.href);
    const method = String(init.method || request?.method || 'GET').toUpperCase();
    if (!['GET','HEAD','OPTIONS'].includes(method) && url.origin !== location.origin && url.hostname !== PROJECT + '.supabase.co') throw Error('TEST_OUTBOUND_MUTATION_BLOCKED');
    let body = typeof init.body === 'string' ? restoreStagedMedia(init.body) : init.body;
    if(typeof body==='string'&&url.pathname.startsWith('/rest/v1/')){try{body=JSON.stringify(namespaceData(JSON.parse(body)));}catch{/* Retain the original invalid JSON for server validation. */}}
    if (typeof body === 'string' && url.pathname.startsWith('/auth/v1/')) {
      try { const value = JSON.parse(body); if (value.email) value.email = value.email.split('@')[0] + '@agdata-test.invalid'; body = JSON.stringify(value); } catch { /* Original invalid JSON reaches the normal validator. */ }
    }
    if(originalUrl.hostname===PROJECT+'.supabase.co'&&originalUrl.pathname.startsWith('/storage/v1/object/')){body=storageRoute(originalUrl,body);url.pathname=originalUrl.pathname;}
    const headers = new Headers(init.headers || request?.headers);
    if (url.hostname === PROJECT + '.supabase.co') {
      if (headers.has('apikey')) headers.set('apikey', config.anonKey);
      for (const key of ['Accept-Profile','Content-Profile']) if (headers.has(key) && headers.get(key) !== 'public' && !headers.get(key).startsWith('test_')) headers.set(key, 'test_' + headers.get(key));
    }
    return nativeFetch(request ? new Request(url, request) : url, { ...init, ...(body !== undefined ? { body } : {}), headers, referrerPolicy: 'no-referrer' });
  };
  if (window.XMLHttpRequest) {
    const xhrOpen=XMLHttpRequest.prototype.open, xhrHeader=XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open=function(method,url,...args){const mapped=rewriteUrl(String(url));if(!['GET','HEAD','OPTIONS'].includes(String(method).toUpperCase())&&mapped.origin!==location.origin&&mapped.hostname!==PROJECT+'.supabase.co')throw Error('TEST_OUTBOUND_MUTATION_BLOCKED');this.__testTarget=mapped.hostname===PROJECT+'.supabase.co';return xhrOpen.call(this,method,mapped.href,...args);};
    XMLHttpRequest.prototype.setRequestHeader=function(name,value){return xhrHeader.call(this,name,this.__testTarget&&String(name).toLowerCase()==='apikey'?config.anonKey:value);};
  }
  function wrapClient(client) {
    const originalChannel = client.channel.bind(client);
    client.channel = (name, options) => {
      const channel = originalChannel(PREFIX + name, options), originalOn = channel.on.bind(channel);
      channel.on = (type, filter, handler) => originalOn(type, type === 'postgres_changes' && filter?.table ? { ...filter, table: resolveName(filter.table), schema: filter.schema && filter.schema !== 'public' ? 'test_' + filter.schema : 'public' } : filter, type==='postgres_changes'?payload=>handler(namespaceData(payload,true)):handler);
      return channel;
    };
    return client;
  }
  window.addEventListener('storage', event => {
    if (!event.key?.startsWith(PREFIX)) { event.stopImmediatePropagation(); return; }
    Object.defineProperty(event, 'key', { value: event.key.slice(PREFIX.length) });
  }, true);
  if (navigator.serviceWorker) {
    const container = navigator.serviceWorker;
    const own = registration => registration?.scope === new URL('/test/', location.origin).href;
    const registrations = container.getRegistrations.bind(container), registration = container.getRegistration.bind(container);
    const register = container.register.bind(container);
    container.getRegistrations = async () => (await registrations()).filter(own);
    container.getRegistration = async () => { const found = await registration('/test/'); return own(found) ? found : undefined; };
    container.register = () => register('/test/sw-test.js', { scope: '/test/' });
    const controllerGetter = Object.getOwnPropertyDescriptor(ServiceWorkerContainer.prototype, 'controller')?.get;
    if (controllerGetter) Object.defineProperty(container, 'controller', { get() { const worker = controllerGetter.call(container); return worker?.scriptURL.startsWith(location.origin + '/test/') ? worker : null; } });
    Object.defineProperty(container, 'ready', { get: async () => { const found = await registration('/test/'); return own(found) ? found : register('/test/sw-test.js', { scope: '/test/' }); } });
    container.addEventListener('message', event => { if (event.source?.scriptURL && !event.source.scriptURL.startsWith(location.origin + '/test/')) event.stopImmediatePropagation(); }, true);
  }

  if(window.WebSocket){
    const NativeSocket=window.WebSocket;
    window.WebSocket=class extends NativeSocket{
      constructor(input,protocols){
        const url=new URL(input,location.href);if(url.hostname.endsWith('.supabase.co')&&url.hostname!==PROJECT+'.supabase.co')throw Error('PRODUCTION_NETWORK_BLOCKED');
        const own=url.hostname===PROJECT+'.supabase.co';if(own&&url.searchParams.has('apikey'))url.searchParams.set('apikey',config.anonKey);
        super(url.href,protocols);this.testIsolated=own;this.testTopics=new Map();
        this.addEventListener('message',event=>{if(!own||event.testNamespaceMapped||typeof event.data!=='string')return;let payload;try{payload=JSON.parse(event.data);}catch{return;}
          if(this.testTopics.has(payload.topic))payload.topic=this.testTopics.get(payload.topic);payload=namespaceData(payload,true);
          const mapped=new MessageEvent('message',{data:JSON.stringify(payload),origin:event.origin});Object.defineProperty(mapped,'testNamespaceMapped',{value:true});event.stopImmediatePropagation();this.dispatchEvent(mapped);
        });
      }
      send(data){if(this.testIsolated&&typeof data==='string'){try{const message=JSON.parse(data);
        if(typeof message.topic==='string'&&message.topic.startsWith('realtime:')&&!message.topic.startsWith('realtime:agdata-test:')){const original=message.topic;message.topic='realtime:agdata-test:'+original.slice(9);this.testTopics.set(message.topic,original);}
        for(const filter of message.payload?.config?.postgres_changes||[]){if(filter.table)filter.table=resolveName(filter.table);if(filter.schema&&filter.schema!=='public'&&!filter.schema.startsWith('test_'))filter.schema='test_'+filter.schema;}
        data=JSON.stringify(message);
      }catch(error){if(!(error instanceof SyntaxError))throw error;}}return super.send(data);}
    };
  }
  let sdk;
  Object.defineProperty(window, 'supabase', { configurable: true, get: () => sdk, set(value) {
    sdk = value && new Proxy(value, { get(target, key, receiver) {
      const current = Reflect.get(target, key, receiver);
      return key === 'createClient' && typeof current === 'function' ? (...args) => wrapClient(current.apply(target, args)) : current;
    }});
  }});
  window.AgDataTest = Object.freeze({ project: PROJECT, recipient: 'dylan_collyge@greenleafnursery.com', resolveName, nativeFetch, rewriteUrl });
  window.addEventListener('load', () => {
    navigator.serviceWorker?.register('/test/sw-test.js', { scope: '/test/' }).catch(() => {});
  }, { once: true });
})();
