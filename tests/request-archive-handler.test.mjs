import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('app-api.ts', source, ts.ScriptTarget.Latest, true);
const code = ts.transpileModule(ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['handleRequestArchive','databaseFailureResponse'].includes(node.name?.text)).map(node => node.getText(ast)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const command = { operation: 'archive', uid: 'exact-request-row', idempotencyKey: '01234567-89ab-4cde-8f01-234567890123' };
function setup(options={}) {
  const calls=[];
  const context=vm.createContext({
    resolveActiveSessionProfile: async () => { if(options.inactive) throw new Error('inactive'); return { id: 'server-verified-profile' }; },
    errorResponse: (message,status,extra={})=>({status,body:{ok:false,...extra}}),
    jsonResponse: body=>({status:200,body}),
    supabase:{rpc:async(name,args)=>{ calls.push({name,args});return options.response || {data:{uid:command.uid,operation:'archive'},error:null};}}
  });
  vm.runInContext(code,context);
  return {calls,run:(payload=command,session={username:'nelly_aguilar'})=>context.handleRequestArchive(session,payload)};
}
test('archive derives actor from the verified session and invokes only its dedicated operation',async()=>{
  const f=setup();const result=await f.run({...command,actorId:'forged',email:'forged'});
  assert.equal(result.status,200);assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].name,'request_archive_command_v1');
  assert.equal(f.calls[0].args.p_actor_id,'server-verified-profile');
  assert.equal(f.calls[0].args.p_uid,command.uid);
  assert.equal(f.calls[0].args.p_idempotency_key,command.idempotencyKey);
});
test('anonymous, inactive, invalid operation and invalid command never reach the database',async()=>{
  const f=setup();assert.equal((await f.run(command,null)).status,401);
  for(const payload of [{...command,operation:'delete'},{...command,uid:''},{...command,idempotencyKey:'not-a-key'}]) assert.equal((await f.run(payload)).status,400);
  assert.equal(f.calls.length,0);
  const inactive=setup({inactive:true});assert.equal((await inactive.run()).status,403);assert.equal(inactive.calls.length,0);
});
test('permission, conflict and missing rows remain terminal HTTP errors',async()=>{
  for(const [code,status] of [['42501',403],['PT409',409],['PT404',404],['PT400',400],['57014',503]]) {
    const f=setup({response:{data:null,error:{code}}});assert.equal((await f.run()).status,status);assert.equal(f.calls.length,1);
  }
});
test('archived reads use authorized RPC and capped stable paging; restore is a distinct idempotent command',async()=>{
  const f=setup();assert.equal((await f.run({operation:'list',limit:800,offset:100})).status,200);
  assert.equal(f.calls[0].name,'request_archive_list_v1');assert.equal(f.calls[0].args.p_limit,500);assert.equal(f.calls[0].args.p_offset,100);
  assert.equal((await f.run({operation:'list',limit:100,offset:-1})).status,400);
  await f.run({...command,operation:'restore'});assert.equal(f.calls[1].args.p_operation,'restore');
});
