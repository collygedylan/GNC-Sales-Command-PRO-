import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const uri=process.env.AURA_LLM_TEST_DB_URL;
if(!uri) throw Error('AURA_LLM_TEST_DB_URL_REQUIRED');
const target=new URL(uri);
if(!['localhost','127.0.0.1','[::1]'].includes(target.hostname)) throw Error('LOCAL_DATABASE_ONLY');
const pool=new pg.Pool({connectionString:uri,max:20});
const ids=Array.from({length:30},()=>randomUUID());
try {
  assert.equal(Number((await pool.query('select count(*) n from aura_private.llm_provider_calls')).rows[0].n),0,'requires isolated empty ledger');
  const results=await Promise.all(ids.map(async id=>{
    const client=await pool.connect();
    try {
      await client.query('begin'); await client.query('set local role service_role');
      const result=await client.query('select public.aura_llm_reserve_call_v1($1,1,100,15,1000000,1500) data',[id]);
      await client.query('commit'); return result.rows[0].data;
    } catch(error) { await client.query('rollback'); throw error; }
    finally { client.release(); }
  }));
  assert.equal(results.filter(r=>r.allowed).length,15,'separate database connections share exactly fifteen slots');
  assert.equal(results.filter(r=>r.reason==='rpm').length,15);
  console.log('AURA quota concurrency: 15 permitted, 15 denied across separate connections.');
} finally {
  await pool.query('delete from aura_private.llm_provider_calls where request_id=any($1::uuid[])',[ids]);
  await pool.end();
}
