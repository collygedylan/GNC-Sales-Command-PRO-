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
