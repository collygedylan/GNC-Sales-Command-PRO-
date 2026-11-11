import {readFileSync} from 'node:fs';
import vm from 'node:vm';

export function transportFixture({native='native-a',legacy='legacy-b',responses=[200]}={}) {
  const calls=[];let refreshed=0;
  const context=vm.createContext({
    Response,Headers,AbortController,setTimeout,clearTimeout,
    window:{},APP_VERSION:'fixture',APP_SHELL_VERSION:'AgData v3.0.34',SUPABASE_KEY:'anon',
    currentUser:'actor-a',nativeAuthRecoveryEpoch:1,PRELOGIN_BACKGROUND_ACTIONS:new Set(),
    isAllowedAppHostname:()=>true,isLoginScreenVisible:()=>false,getCurrentAppSessionToken:()=>legacy,
    getNativeAuthRequestHeaders:async refresh=>{if(refresh)refreshed++;return native?{Authorization:'Bearer '+(refresh?'native-renewed':native)}:null;},
    nativeSessionRecoveryError:()=>Object.assign(new Error('Session required'),{code:'NATIVE_SESSION_RECOVERY_REQUIRED'}),
    staleSupabaseReadScopeError:()=>Object.assign(new Error('Scope changed'),{code:'REQUEST_SCOPE_CHANGED'}),
    canRunManualInventoryImport:()=>true,
  });
  context.getSupabaseReadIdentityScope=()=>context.currentUser;
  for(const name of ['operational-rpc-retry','rpc-recovery-domain','app-api-transport']) {
    const source=readFileSync(new URL('../../src/services/'+name+'.js',import.meta.url),'utf8');
    vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),context);
  }
  context.fetchWithTimeout=async(url,request,_timeout,_label,consume)=>{
    calls.push({url,headers:{...request.headers},body:JSON.parse(request.body)});
    const status=responses[Math.min(calls.length-1,responses.length-1)];
    const response=Response.json(status===200?{ok:true}:{code:'AUTH_REQUIRED'},{status});
    return consume?consume(response,request.signal):response;
  };
  return {context,calls,get refreshed(){return refreshed;}};
}
