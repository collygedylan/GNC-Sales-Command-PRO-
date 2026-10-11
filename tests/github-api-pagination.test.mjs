import assert from 'node:assert/strict';
import test from 'node:test';
import { GitHubPaginationError, listGitHubApiItems } from '../scripts/github-api-pagination.mjs';

const row = id => ({ id, name: `item-${id}` });
const failure = code => new RegExp(`GITHUB_PAGINATION_${code}`);

test('zero-item pages are complete and valid', async () => {
  const items = await listGitHubApiItems({ api: async () => ({ total_count: 0, jobs: [] }), endpoint: 'repos/example/app/jobs', field: 'jobs' });
  assert.deepEqual(items, []);
});

test('default job pages are bounded at 25 while retaining the complete 2,000-job ceiling', async () => {
  const all = Array.from({ length: 2000 }, (_, index) => row(index + 1));
  const pages = [];
  const items = await listGitHubApiItems({ endpoint: '/jobs?per_page=100', field: 'jobs',
    api: async endpoint => {
      const params = new URL(endpoint, 'https://fixture.invalid').searchParams;
      const page = Number(params.get('page') || 1);
      assert.equal(params.get('per_page'), '25');
      pages.push(page);
      return { total_count: all.length, jobs: all.slice((page - 1) * 25, page * 25) };
    },
  });
  assert.deepEqual(items, all);
  assert.deepEqual(pages, Array.from({ length: 80 }, (_, index) => index + 1));
  await assert.rejects(listGitHubApiItems({ endpoint: '/jobs', field: 'jobs',
    api: async () => ({ total_count: 2001, jobs: [] }),
  }), failure('TOTAL_INVALID'));
});

test('non-job envelopes retain their existing page and item bounds', async () => {
  for (const field of ['workflow_runs', 'artifacts']) {
    await listGitHubApiItems({ endpoint: '/metadata', field, api: async endpoint => {
      assert.equal(new URL(endpoint, 'https://fixture.invalid').searchParams.get('per_page'), '100');
      return { total_count: 0, [field]: [] };
    } });
  }
});

for (const field of ['workflow_runs', 'jobs', 'artifacts']) test(`collects complete multi-page ${field} envelopes`, async () => {
  const requests = [];
  const all = [row(1), row(2), row(3)];
  const items = await listGitHubApiItems({
    endpoint: 'repos/example/app/actions?head_sha=abc123&event=pull_request', field, perPage: 2,
    api: async url => {
      requests.push(new URL(url, 'https://api.github.com'));
      const page = Number(requests.at(-1).searchParams.get('page') || 1);
      return { total_count: all.length, [field]: all.slice((page - 1) * 2, page * 2) };
    },
  });
  assert.deepEqual(items, all);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].searchParams.get('head_sha'), 'abc123');
  assert.equal(requests[0].searchParams.get('event'), 'pull_request');
  assert.equal(requests[0].searchParams.get('per_page'), '2');
  assert.equal(requests[0].searchParams.get('page'), null);
  assert.equal(requests[1].searchParams.get('page'), '2');
});

test('all pages must have unique positive safe integer IDs', async () => {
  await assert.rejects(listGitHubApiItems({ endpoint: '/items', field: 'items', api: async () => ({ total_count: 2, items: [row(1), row(1)] }) }), failure('DUPLICATE_ID'));
  for (const id of [0, -1, '1', Number.MAX_SAFE_INTEGER + 1, null]) {
    await assert.rejects(listGitHubApiItems({ endpoint: '/items', field: 'items', api: async () => ({ total_count: 1, items: [row(id)] }) }), failure('ITEM_ID_INVALID'));
  }
});

test('malformed totals, page envelopes, and item arrays fail closed', async () => {
  for (const total_count of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
    await assert.rejects(listGitHubApiItems({ endpoint: '/items', field: 'items', api: async () => ({ total_count, items: [] }) }), failure('TOTAL_INVALID'));
  }
  await assert.rejects(listGitHubApiItems({ endpoint: '/items', field: 'items', api: async () => [] }), failure('PAGE_INVALID'));
  await assert.rejects(listGitHubApiItems({ endpoint: '/items', field: 'items', api: async () => ({ total_count: 0, items: null }) }), failure('ITEMS_INVALID'));
  await assert.rejects(listGitHubApiItems({ endpoint: '/items', field: 'items', api: async () => ({ total_count: 0, items: [row(1)] }) }), failure('COUNT_OVERFLOW'));
  await assert.rejects(listGitHubApiItems({ endpoint: '/items', field: 'items', perPage: 1, api: async () => ({ total_count: 1, items: [row(1), row(2)] }) }), failure('ITEMS_INVALID'));
});

test('count drift, short pages, and empty intermediate pages fail closed', async () => {
  await assert.rejects(listGitHubApiItems({
    endpoint: '/items', field: 'items', perPage: 2,
    api: async url => {
      const page = Number(new URL(url, 'https://fixture.invalid').searchParams.get('page') || 1);
      return page === 1 ? { total_count: 3, items: [row(1), row(2)] } : { total_count: 4, items: [row(3), row(4)] };
    },
  }), failure('TOTAL_DRIFT'));
  await assert.rejects(listGitHubApiItems({ endpoint: '/items', field: 'items', perPage: 2,
    api: async () => ({ total_count: 3, items: [row(1)] }) }), failure('TRUNCATED_PAGE'));
  await assert.rejects(listGitHubApiItems({
    endpoint: '/items', field: 'items', perPage: 2,
    api: async url => {
      const page = Number(new URL(url, 'https://fixture.invalid').searchParams.get('page') || 1);
      return { total_count: 3, items: page === 1 ? [row(1), row(2)] : [] };
    },
  }), failure('EMPTY_PAGE'));
});

test('page and item limits are enforced before returning partial lists', async () => {
  await assert.rejects(listGitHubApiItems({ endpoint: '/items', field: 'items', perPage: 2, maxPages: 2,
    api: async url => {
      const page = Number(new URL(url, 'https://fixture.invalid').searchParams.get('page') || 1);
      return { total_count: 5, items: [row(page * 2 - 1), row(page * 2)] };
    },
  }), failure('PAGE_LIMIT'));
  await assert.rejects(listGitHubApiItems({ endpoint: '/items', field: 'items', maxItems: 2,
    api: async () => ({ total_count: 3, items: [] }) }), failure('TOTAL_INVALID'));
});

test('invalid options and API transport failures are surfaced', async () => {
  for (const options of [
    { field: 'Bad' }, { perPage: 0 }, { perPage: 101 }, { maxPages: 0 }, { maxItems: 0 }, { api: null },
  ]) await assert.rejects(listGitHubApiItems({ endpoint: '/items', field: 'items', api: async () => ({ total_count: 0, items: [] }), ...options }), failure('OPTIONS_INVALID'));
  await assert.rejects(listGitHubApiItems({ endpoint: '/items', field: 'items', api: async () => { throw new Error('API_UNAVAILABLE'); } }), /API_UNAVAILABLE/);
  await assert.rejects(listGitHubApiItems({ endpoint: '', field: 'items', api: async () => ({ total_count: 0, items: [] }) }), error => {
    assert.ok(error instanceof GitHubPaginationError);
    assert.equal(error.code, 'ENDPOINT_INVALID');
    return true;
  });
});
