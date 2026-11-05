import { testNativeFetch } from './test-isolation.ts';
const PROJECT='https://apztnscvagayslumnalr.supabase.co';
const BUCKET='farm-operations-staging';
const folders:Record<string,string>={};
for(const stage of ['drive','cav','reserves','soc','hl-po']){
 folders['test-'+stage]='erp-drops/'+stage;
 folders['test-'+stage+'-processed']='erp-drops/'+stage+'/Processed';
}
const headers=()=>({apikey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',Authorization:'Bearer '+(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''),'Content-Type':'application/json'});
export function testSyncEnv(key:string):string{
 if(key==='ERP_SYNC_DROP_FOLDERS_JSON')return JSON.stringify({drive:'test-drive',cav:'test-cav',reserves:'test-reserves',soc:'test-soc'});
 return Deno.env.get(key)||'';
}
type StoredFile={id:string;name:string;updated_at?:string;created_at?:string;metadata?:Record<string,unknown>};
const parentId=(name:string):string=>Object.entries(folders).find(([,prefix])=>name.slice(0,name.lastIndexOf('/'))===prefix)?.[0]||'';
function metadata(file:StoredFile){return {id:'test-file:'+file.id,name:file.name.split('/').at(-1),mimeType:file.metadata?.mimetype||'application/octet-stream',modifiedTime:file.updated_at,createdTime:file.created_at,size:String(file.metadata?.size||0),md5Checksum:String(file.metadata?.eTag||file.metadata?.etag||'').replaceAll('"',''),parents:[parentId(file.name)]};}
async function readFile(id:string):Promise<StoredFile>{
 if(!/^test-file:[0-9a-f-]{36}$/.test(id))throw Error('TEST_FILE_ID_REQUIRED');
 const response=await testNativeFetch(PROJECT+'/rest/v1/rpc/test_sync_file_metadata',{method:'POST',headers:headers(),body:JSON.stringify({object_id:id.slice(10)})});
 const value=await response.json();if(!response.ok||!value?.id)throw Error('TEST_FILE_NOT_FOUND');return value;
}
export async function testDriveFetch(input:RequestInfo|URL,init:RequestInit={}):Promise<Response>{
 const url=new URL(input instanceof Request?input.url:String(input));
 if(url.hostname!=='www.googleapis.com')return fetch(input,init);
 if(!url.pathname.startsWith('/drive/v3/files'))throw Error('TEST_DRIVE_ROUTE_DENIED');
 const method=String(init.method||'GET').toUpperCase();
 const id=decodeURIComponent(url.pathname.slice('/drive/v3/files/'.length));
 const reply=(value:unknown,status=200)=>Response.json(value,{status});
 if(url.pathname==='/drive/v3/files'&&method==='GET'){
  const q=url.searchParams.get('q')||'',folder=/['"]([^'"]+)['"] in parents/.exec(q)?.[1]||'',prefix=folders[folder];
  if(!prefix)throw Error('TEST_DROP_FOLDER_REQUIRED');
  const offset=Number(url.searchParams.get('pageToken')||0);
  const response=await testNativeFetch(PROJECT+'/storage/v1/object/list/'+BUCKET,{method:'POST',headers:headers(),body:JSON.stringify({prefix,limit:1000,offset,sortBy:{column:'name',order:'asc'}})});
  const objects=await response.json();if(!response.ok||!Array.isArray(objects))throw Error('TEST_DROP_LIST_FAILED');
  const files=objects.filter((file:StoredFile)=>file.id).map((file:StoredFile)=>metadata({...file,name:prefix+'/'+file.name}));
  if(!q.includes('mimeType=')&&!folder.endsWith('-processed'))files.push({id:folder+'-processed',name:'Processed',mimeType:'application/vnd.google-apps.folder',modifiedTime:undefined,createdTime:undefined,size:'0',md5Checksum:'',parents:[folder]});
  return reply({files,nextPageToken:objects.length===1000?String(offset+1000):undefined});
 }
 if(url.pathname==='/drive/v3/files'&&method==='POST'){
  const body=JSON.parse(String(init.body||'{}')) as {name?:string;parents?:string[]};
  if(body.name!=='Processed'||!folders[body.parents?.[0]||''])throw Error('TEST_FOLDER_CREATE_DENIED');
  return reply({id:body.parents![0]+'-processed'});
 }
 if(folders[id]&&method==='GET')return reply({id,name:id.endsWith('-processed')?'Processed':id,parents:[]});
 const file=await readFile(id);
 if(method==='GET'&&url.searchParams.get('alt')==='media')return testNativeFetch(PROJECT+'/storage/v1/object/authenticated/'+BUCKET+'/'+file.name,{headers:headers()});
 if(method==='GET')return reply(metadata(file));
 if(method==='PATCH'){
  const destination=folders[url.searchParams.get('addParents')||''];
  if(!destination?.endsWith('/Processed')||destination.split('/')[1]!==file.name.split('/')[1])throw Error('TEST_PROCESSED_DESTINATION_REQUIRED');
  const newName=destination+'/'+file.name.split('/').at(-1);
  const moved=await testNativeFetch(PROJECT+'/storage/v1/object/move',{method:'POST',headers:headers(),body:JSON.stringify({bucketId:BUCKET,sourceKey:file.name,destinationKey:newName})});
  if(!moved.ok)throw Error('TEST_PROCESSED_MOVE_FAILED');return reply(metadata({...file,name:newName}));
 }
 return reply({error:'TEST_DRIVE_OPERATION_DENIED'},405);
}
