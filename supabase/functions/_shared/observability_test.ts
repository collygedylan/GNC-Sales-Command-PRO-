import { withObservedRequest } from './observability.ts';

Deno.test('bounded handlers enter without a pre-deadline read of the request body', async () => {
  const controller = new AbortController();
  const request = new Request('https://example.invalid/aura', {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
    body: new ReadableStream({ start() { /* Deliberately pending until cancelled. */ } }),
  });
  let entered = false;
  const response = await withObservedRequest('aura-llm-router', request, async () => {
    entered = true;
    return new Response('{}', { status: 200 });
  }, { action: 'aura_llm' });
  controller.abort();
  if (!entered || response.status !== 200) throw new Error('Fixed-action instrumentation delayed the handler.');
  await request.body?.cancel();
});

Deno.test('opt-in handler timing preserves the response and contains only a finite aggregate duration', async () => {
  const response = await withObservedRequest('app-api', new Request('https://example.invalid/api', {
    headers: { 'x-request-id': 'timing-test' },
  }), async () => new Response('{"ok":true}', {
    status: 200, headers: { 'cache-control': 'private, no-store', 'server-timing': 'existing;dur=1' },
  }), { serverTiming: true });
  const timing = response.headers.get('server-timing') || '';
  if (!/^existing;dur=1, app;dur=\d+\.\d$/.test(timing)) throw new Error('Expected bounded aggregate timing.');
  if (response.status !== 200 || await response.text() !== '{"ok":true}'
    || response.headers.get('cache-control') !== 'private, no-store'
    || response.headers.get('x-request-id') !== 'timing-test') throw new Error('Response contract changed.');
});

Deno.test('handler timing is absent by default and safe on a failed handler', async () => {
  const plain = await withObservedRequest('example', new Request('https://example.invalid'), async () => new Response('{}'));
  if (plain.headers.has('server-timing')) throw new Error('Timing must be opt-in.');
  const failed = await withObservedRequest('app-api', new Request('https://example.invalid'), async () => {
    throw new Error('private database detail');
  }, { serverTiming: true });
  if (failed.status !== 500 || !/^app;dur=\d+\.\d$/.test(failed.headers.get('server-timing') || '')) {
    throw new Error('Failure timing contract is invalid.');
  }
  if ((await failed.text()).includes('private database')) throw new Error('Failure details escaped.');
});
