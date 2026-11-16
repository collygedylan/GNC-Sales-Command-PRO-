import test from 'node:test';

test('Invariant 666: passive status loops pause hidden and offline work with single-flight exponential backoff', async () =>
  (await import('../../tests/helpers/quota-poll-contract.mjs')).assertQuotaPollingContract());
test('Invariant 667: canonical poll responses cache only server-tagged successful reads and preserve denial statuses', async () =>
  (await import('./golden-poll-response-contract.mjs')).assertCanonicalPollResponse());
test('Invariant 668: folder preparation reuses canonical membership and newline hashes with actor, lease and dependency guards', async () =>
  (await import('./golden-completion-preparation-contract.mjs')).assertCanonicalCompletionPreparation());
