import names from './test-namespace.json' with { type: 'json' };

const PROJECT = 'apztnscvagayslumnalr';
const TARGET = `https://${PROJECT}.supabase.co`;
const nativeFetch = globalThis.fetch.bind(globalThis);
const objectNames: Record<string, string> = names;
const objectName = (name: string): string => {
  if (name.startsWith('test_')) return name;
  if (objectNames[name]) return objectNames[name];
  throw new Error(`UNMAPPED_TEST_DATABASE_OBJECT:${name}`);
};
const logical=objectNames;

  const reverseNames:Record<string,string> = Object.fromEntries(Object.entries(logical).map(([key,value])=>[value,key]));
  const namespaceFields = /^(?:p_)?(?:key|keys|source_key|source_keys|canonical_keys|source_table|table|table_name|relation|relation_name|target_table)$/i;
  function namespaceId(value:string,reverse=false):string {
    const map=reverse?reverseNames:logical;if(map[value])return map[value];
    if(value.startsWith('public.'))return 'public.'+(map[value.slice(7)]||value.slice(7));
    const match=/^(test_)?(private|bloomscapes_private|hl_order_private|sales_private|aura_private|labor_internal|import_private|suspend_tag_private|app_sync_private|bunch_note_private|workflow_private)\.(.+)$/.exec(value);
    return match?(reverse?'':'test_')+match[2]+'.'+match[3]:value;
  }
  function namespaceData(value:unknown,reverse=false,field=''):unknown {
    if(typeof value==='string')return namespaceFields.test(field)?namespaceId(value,reverse):value;
    if(Array.isArray(value))return value.map(v=>namespaceData(v,reverse,field));
    if(value&&typeof value==='object'){const result:Record<string,unknown>={};for(const [key,v] of Object.entries(value))result[namespaceId(key,reverse)]=namespaceData(v,reverse,key);return result;}
    return value;
  }
  function namespaceQuery(url:URL):void {
    const select=url.searchParams.get('select');if(select)url.searchParams.set('select',select.replace(/\b([A-Za-z_][\w]*)(?=\s*(?:!|\())/g,(name:string,offset:number,text:string)=>logical[name]?(text[offset-1]===':'?'':name+':')+logical[name]:name));
    for(const [key,value] of [...url.searchParams])if(namespaceFields.test(key))url.searchParams.set(key,value.replace(/(?<![A-Za-z_])(?:public\.)?(?:[A-Za-z_][\w]*_private\.)?[A-Za-z_][\w]*/g,name=>namespaceId(name)));
  }


  function storageRoute(url:URL,body:BodyInit|null|undefined):BodyInit|null|undefined {
    if(!url.pathname.startsWith('/storage/v1/object/'))return body;
    const parts=url.pathname.split('/'),mode=parts[4];let value:Record<string,unknown>|null;
    try{value=typeof body==='string'?JSON.parse(body):null;}catch{value=null;}
    if(['move','copy'].includes(mode)){
      if(value?.bucketId&&value.bucketId!=='farm-operations-staging'){const old=String(value.bucketId);value.bucketId='farm-operations-staging';for(const key of ['sourceKey','destinationKey'])if(typeof value[key]==='string')value[key]=old+'/'+value[key];}
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

const schemaName = (name: string): string => name === 'public' || name.startsWith('test_') ? name : 'test_' + name;
const resolveRestUrl = (url: URL, privateProfile=false): void => {
  const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
  const table = url.pathname.match(/^\/rest\/v1\/([^/]+)$/);
  if (rpc && !privateProfile) url.pathname = '/rest/v1/rpc/' + objectName(rpc[1]);
  else if (table && !privateProfile) url.pathname = '/rest/v1/' + objectName(table[1]);
  namespaceQuery(url);
};

globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input));
  const method = String(init.method || request?.method || 'GET').toUpperCase();
  if (url.hostname.endsWith('.supabase.co') && url.origin !== TARGET) throw new Error('TEST_PRODUCTION_HOST_BLOCKED');
  if (url.origin !== TARGET) {
    // Only public weather/geocoding reads leave the isolated Supabase project.
    const allowed = ['api.open-meteo.com', 'geocoding-api.open-meteo.com', 'api.weather.gov'];
    const assistantProvider = ['generativelanguage.googleapis.com','api.openai.com'].includes(url.hostname);
    if (!assistantProvider && (!['GET','HEAD'].includes(method) || !allowed.includes(url.hostname))) throw new Error('TEST_EXTERNAL_DISPATCH_DISABLED');
    return nativeFetch(input, init);
  }
  const originalProfile=new Headers(init.headers||request?.headers).get('Content-Profile')||new Headers(init.headers||request?.headers).get('Accept-Profile');
  resolveRestUrl(url,Boolean(originalProfile&&originalProfile!=='public'));
  if (url.pathname.startsWith('/functions/v1/')) url.pathname = url.pathname.replace(/^\/functions\/v1\/(?!test-)/, '/functions/v1/test-');
  if (/^\/auth\/v1\/(recover|resend|signup|otp|invite|authorize)/.test(url.pathname)) throw new Error('TEST_AUTH_MAIL_DISABLED');
  const headers = new Headers(init.headers || request?.headers);
  for (const profile of ['Accept-Profile', 'Content-Profile']) {
    if (headers.has(profile)) headers.set(profile, schemaName(headers.get(profile)!));
  }
  let body = init.body;
  if (typeof body === 'string' && headers.get('content-type')?.includes('application/json')) {
    try {
      const value = namespaceData(JSON.parse(body)) as Record<string,unknown>;
      if (url.pathname.startsWith('/auth/v1/') && typeof value.email === 'string') value.email = value.email.split('@')[0] + '@agdata-test.invalid';
      for (const key of ['p_table', 'p_table_name', 'p_relation', 'table_name']) if (typeof value[key] === 'string' && objectNames[value[key]]) value[key] = objectName(value[key]);
      body = JSON.stringify(value);
    } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  }
  body=storageRoute(url,body);
  const response=await nativeFetch(request ? new Request(url, request) : url, { ...init, ...(body !== undefined ? { body } : {}), headers });
  if(url.pathname.startsWith('/rest/v1/')&&response.headers.get('content-type')?.includes('application/json')){const text=await response.text();try{const responseHeaders=new Headers(response.headers);responseHeaders.delete('content-length');return new Response(JSON.stringify(namespaceData(JSON.parse(text),true)),{status:response.status,statusText:response.statusText,headers:responseHeaders});}catch{return new Response(text,{status:response.status,headers:response.headers});}}
  return response;
};

// Only the dedicated mail worker may use this native transport, with its fixed recipient.
export const testNativeFetch = nativeFetch;
export const testProjectUrl = TARGET;
