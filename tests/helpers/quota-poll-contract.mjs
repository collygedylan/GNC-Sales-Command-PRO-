import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness(run) {
    const timers = new Map(), handlers = new Map();
    let id = 0;
    const document = {hidden:false,addEventListener:bind,removeEventListener:unbind};
    function bind(event, callback) { handlers.set(event, callback); }
    function unbind(event) { handlers.delete(event); }
    const root = {document,navigator:{onLine:true},addEventListener:bind,removeEventListener:unbind,
        setTimeout(callback,delay) { timers.set(++id,{callback,delay}); return id; },
        clearTimeout(key) { timers.delete(key); }};
    const source = fs.readFileSync(new URL('../../src/services/quota-poll-loop.js',import.meta.url),'utf8');
    vm.runInNewContext(source.replace(/^export /gm,''),{window:root,Promise});
    const poll = root.GncQuotaPolling.create({enabled:()=>true,run},root);
    async function fire() {
        const [key,task] = timers.entries().next().value;
        timers.delete(key);
        await task.callback();
    }
    return {root,timers,handlers,poll,fire};
}

export async function assertQuotaPollingContract() {
    let calls = 0;
    const h = harness(async()=>{calls++;return true;});
    h.poll.start();
    assert.equal([...h.timers.values()][0].delay,300000);
    h.root.document.hidden = true;
    h.handlers.get('visibilitychange')();
    assert.equal(h.timers.size,0);
    assert.equal(calls,0);
    h.root.document.hidden = false;
    h.handlers.get('visibilitychange')();
    await h.fire();
    assert.equal(calls,1);
    assert.equal([...h.timers.values()][0].delay,300000);
    h.root.navigator.onLine = false;
    h.handlers.get('offline')();
    assert.equal(h.timers.size,0);
    h.poll.dispose();
    assert.equal(h.handlers.size,0);
    const failed = harness(async()=>false);
    failed.poll.start();
    await failed.fire();
    assert.equal([...failed.timers.values()][0].delay,600000);
    failed.poll.stop();
    assert.equal(failed.timers.size,0);
    await assertSingleFlight();
}

async function assertSingleFlight() {
    let finish, calls = 0;
    const h = harness(()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
    h.poll.start(true);
    const pending = h.fire();
    await Promise.resolve();
    h.poll.start(true);
    assert.equal(h.timers.size,0);
    finish(true);
    await pending;
    assert.equal(calls,1);
    h.poll.dispose();
}
