export class GitHubPaginationError extends Error {
  constructor(code) {
    super(`GITHUB_PAGINATION_${code}`);
    this.name = 'GitHubPaginationError';
    this.code = code;
  }
}

function numberedEndpoint(endpoint, page, perPage) {
  if (typeof endpoint !== 'string' || !endpoint.trim()) throw new GitHubPaginationError('ENDPOINT_INVALID');
  const [resource, query = ''] = endpoint.split('?');
  const params = new URLSearchParams(query);
  params.set('per_page', String(perPage));
  if (page > 1 || params.has('page')) params.set('page', String(page));
  return `${resource}?${params}`;
}

export async function listGitHubApiItems({ api, endpoint, field, perPage = 100, maxPages = 20, maxItems = 2000 }) {
  if (typeof api !== 'function' || typeof field !== 'string' || !/^[a-z][a-z0-9_]*$/.test(field)
    || !Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100
    || !Number.isSafeInteger(maxPages) || maxPages < 1
    || !Number.isSafeInteger(maxItems) || maxItems < 1) throw new GitHubPaginationError('OPTIONS_INVALID');

  const collected = [];
  const ids = new Set();
  let expectedTotal;
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
    const page = await api(numberedEndpoint(endpoint, pageNumber, perPage));
    if (!page || typeof page !== 'object' || Array.isArray(page)) throw new GitHubPaginationError('PAGE_INVALID');
    if (!Number.isSafeInteger(page.total_count) || page.total_count < 0 || page.total_count > maxItems) {
      throw new GitHubPaginationError('TOTAL_INVALID');
    }
    if (expectedTotal === undefined) expectedTotal = page.total_count;
    else if (page.total_count !== expectedTotal) throw new GitHubPaginationError('TOTAL_DRIFT');
    if (!Array.isArray(page[field]) || page[field].length > perPage) throw new GitHubPaginationError('ITEMS_INVALID');

    const items = page[field];
    if (collected.length + items.length > expectedTotal) throw new GitHubPaginationError('COUNT_OVERFLOW');
    if (expectedTotal > collected.length && items.length === 0) throw new GitHubPaginationError('EMPTY_PAGE');
    if (collected.length + items.length < expectedTotal && items.length !== perPage) {
      throw new GitHubPaginationError('TRUNCATED_PAGE');
    }
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)
        || !Number.isSafeInteger(item.id) || item.id < 1) throw new GitHubPaginationError('ITEM_ID_INVALID');
      if (ids.has(item.id)) throw new GitHubPaginationError('DUPLICATE_ID');
      ids.add(item.id);
      collected.push(item);
    }
    if (collected.length === expectedTotal) return collected;
  }
  throw new GitHubPaginationError('PAGE_LIMIT');
}
