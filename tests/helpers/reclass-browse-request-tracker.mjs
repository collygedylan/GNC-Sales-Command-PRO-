/** Match only the production paged browse read used by the Drive list. */
export function isMasterBrowseInventoryReadBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const params = body.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return false;
  const offset = Number(params.offset);
  return body.action === 'inventory_read'
    && body.operation === 'master_page'
    && params.dataset === 'master'
    && params.projection === 'browse'
    && Number.isSafeInteger(offset) && offset >= 0
    && Number(params.limit) === 500;
}
