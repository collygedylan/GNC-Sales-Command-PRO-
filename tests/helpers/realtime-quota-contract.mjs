import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

async function advanceTimers(timers, clock) {
  for (let tick=0;tick<30;tick++) {
    for (const [id,timer] of timers) {
      if (timer.at<=clock) {timers.delete(id);timer.callback();}
    }
    await Promise.resolve();
  }
}

export async function assertRealtimeQuotaContract(base = new URL('../../', import.meta.url)) {
    const source = fs.readFileSync(new URL('assets/live-sync-coordinator.js', base), 'utf8');
    const context = { module: { exports: {} }, AbortController, setTimeout, clearTimeout, console };
    vm.runInNewContext(source, context);
    let clock = 0, timerId = 0, notify, subscriptions = 0, closed = 0, reads = 0;
    const timers = new Map();
    const state = { scope: 'actor-a', viewKey: 'docks', authenticated: true, visible: true, online: true,
      adapters: [{ id: 'soc', cacheKey: 'soc/all', sourceKeys: ['ph_soc_master'], stage: async () => [], commit() {} }] };
    const coordinator = context.module.exports.createCoordinator({
      getContext: () => state, now: () => clock,
      readRevisions: async keys => { reads++; return { contractVersion: 1, permissionVersion: '1',
        sources: keys.map(key => ({ key, revision: '1', state: 'ready' })) }; },
      subscribe: callback => { subscriptions++; notify = callback; return () => closed++; },
      setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, at: clock + delay }); return id; },
      clearTimeout: id => timers.delete(id)
    });
    const advance = async ms => { clock += ms; await advanceTimers(timers,clock); };
    await coordinator.check('initial');
    assert.equal(subscriptions, 1);
    const before = reads;
    for (let i = 0; i < 50; i++) notify({ new: { key: 'ph_soc_master' } });
    await advance(2499); assert.equal(reads, before);
    notify({ new: { key: 'ph_soc_master' } });
    await advance(2499); assert.equal(reads, before);
    await advance(1); assert.ok(reads > before);
    const after = reads;
    await advance(1); assert.equal(reads, after);
    state.viewKey = 'av'; await coordinator.check('view-entry'); assert.equal(subscriptions, 1);
    notify({ new: { key: 'ph_soc_master' } });
    coordinator.reset(); const resetReads = reads;
    await advance(2500); assert.equal(reads, resetReads); assert.equal(closed, 1);
    const runtime = fs.readFileSync(new URL('assets/app-runtime.js', base), 'utf8');
    assert.equal((runtime.match(/supabaseClient\.channel\(/g) || []).length, 1);
    assert.match(runtime, /REALTIME_CHANGE_BATCH_MS = 500/);
  assert.match(source, /Math\.max\(2500, Number\(options\.realtimeDebounceMs\) \|\| 2500\)/);
  assert.equal(fs.existsSync(new URL('test/index.html',base)),false,'retired app is not restored');
}

export async function assertPhotoTargetContract() {
  const calls = [];
  class Canvas {
    constructor(width,height) { this.width=width; this.height=height; }
    getContext() { return {fillRect(){},drawImage(){}}; }
    async convertToBlob({type,quality}) { calls.push({width:this.width,height:this.height,quality}); return new Blob([new Uint8Array([255,216,255,1])],{type}); }
  }
  const ctx = {self:{},OffscreenCanvas:Canvas,Blob,Uint8Array};
  vm.runInNewContext(fs.readFileSync(new URL('../../assets/image-optimize-worker-v2026090401.js',import.meta.url),'utf8'),ctx);
  const result=await ctx.encodePhotoSet({width:3840,height:2160},'image/jpeg');
  assert.deepEqual(calls[0],{width:1920,height:1080,quality:0.90});
  assert.ok(result.display.blob.size<=204800);assert.equal(result.thumbnail144.width,144);assert.equal(result.thumbnail320.width,320);
  calls.length=0;await ctx.encodePhotoSet({width:100,height:80},'image/jpeg',true);
  assert.deepEqual(calls[0],{width:100,height:80,quality:0.90});
  assert.equal(fs.existsSync(new URL('../../test/index.html',import.meta.url)),false,'retired app is not restored');
}
