import test from 'node:test';
globalThis.Deno={test};
await import('./photo-upload-edge_test.ts');
