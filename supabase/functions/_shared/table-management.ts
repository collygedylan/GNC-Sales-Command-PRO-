export type ManagerTableKey =
  | 'company-directory'
  | 'inquiry-coverage'
  | 'historical-drive-mode'
  | 'historical-soc-open-orders'
  | 'historical-soc-reserves'
  | 'historical-requests'
  | 'photo-history';

export type ManagerTableOperation = 'read' | 'users' | 'create' | 'update' | 'delete';

export type ManagerTableManagementRequest = {
  operation: ManagerTableOperation;
  table: ManagerTableKey;
  payload: Record<string, unknown>;
};

const TABLES = new Set<ManagerTableKey>([
  'company-directory', 'inquiry-coverage', 'historical-drive-mode', 'historical-soc-open-orders',
  'historical-soc-reserves', 'historical-requests', 'photo-history',
]);
const READ_ONLY_TABLES = new Set<ManagerTableKey>([
  'historical-drive-mode', 'historical-soc-open-orders', 'historical-soc-reserves', 'historical-requests', 'photo-history',
]);
const OPERATIONS = new Set<ManagerTableOperation>(['read', 'users', 'create', 'update', 'delete']);
const COMPANY_FIELDS = new Set(['name', 'username', 'email', 'phone', 'userrole', 'department', 'territory', 'active']);
const COVERAGE_FIELDS = new Set(['block', 'location', 'group_name', 'scope', 'primary_user', 'backup_user', 'notes', 'active']);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function cleanString(value: unknown, key: string, max: number, required = false): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new Error('MANAGER_TABLE_FIELD_INVALID');
    return undefined;
  }
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new Error('MANAGER_TABLE_FIELD_INVALID');
  }
  const result = value.trim();
  if (key === 'email' && result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new Error('MANAGER_TABLE_EMAIL_INVALID');
  return result;
}

function cleanPayload(table: ManagerTableKey, operation: ManagerTableOperation, source: Record<string, unknown>) {
  if (operation === 'read') {
    const allowed = new Set(['page', 'pageSize', 'q']);
    if (!Object.keys(source).every(key => allowed.has(key))) throw new Error('MANAGER_TABLE_PAYLOAD_INVALID');
    const page = source.page ?? 0;
    const pageSize = source.pageSize ?? 100;
    if (!Number.isSafeInteger(page) || Number(page) < 0 || Number(page) > 10000
      || !Number.isSafeInteger(pageSize) || Number(pageSize) < 1 || Number(pageSize) > 200) {
      throw new Error('MANAGER_TABLE_PAGE_INVALID');
    }
    return { page, pageSize, q: cleanString(source.q ?? '', 'q', 120) || '' };
  }
  if (operation === 'users') {
    if (Object.keys(source).length) throw new Error('MANAGER_TABLE_PAYLOAD_INVALID');
    return {};
  }
  const allowed = table === 'company-directory' ? COMPANY_FIELDS : COVERAGE_FIELDS;
  const fields = Object.keys(source).filter(key => !['id', 'expectedRevision', 'command_id'].includes(key));
  if (!fields.length && operation !== 'delete') throw new Error('MANAGER_TABLE_PAYLOAD_INVALID');
  if (!fields.every(key => allowed.has(key))) throw new Error('MANAGER_TABLE_FIELDS_FORBIDDEN');
  const result: Record<string, unknown> = {};
  for (const key of fields) {
    if (key === 'active') {
      if (typeof source[key] !== 'boolean') throw new Error('MANAGER_TABLE_FIELD_INVALID');
      result[key] = source[key];
    } else {
      const maximum = key === 'notes' ? 2000 : key === 'email' ? 254 : key === 'name' ? 160 : key === 'username' ? 80
        : key === 'phone' || key === 'userrole' ? 64 : 120;
      result[key] = cleanString(source[key], key, maximum, key === 'name' || key === 'primary_user');
    }
  }
  if (table === 'inquiry-coverage' && result.scope !== undefined
    && !['block', 'location', 'group', 'all'].includes(String(result.scope))) throw new Error('MANAGER_TABLE_SCOPE_INVALID');
  if (operation === 'create' && table === 'company-directory' && !result.name) throw new Error('MANAGER_TABLE_FIELD_INVALID');
  if (operation === 'create' && table === 'inquiry-coverage'
    && (!result.primary_user || !result.scope)) throw new Error('MANAGER_TABLE_FIELD_INVALID');
  if (operation === 'update' || operation === 'delete') {
    const id = cleanString(source.id, 'id', 36, true);
    const expectedRevision = cleanString(String(source.expectedRevision ?? ''), 'expectedRevision', 19, true);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id || '')
      || !/^[1-9][0-9]{0,18}$/.test(expectedRevision || '')) throw new Error('MANAGER_TABLE_REVISION_INVALID');
    result.id = id;
    result.expectedRevision = expectedRevision;
  }
  const commandId = cleanString(source.command_id, 'command_id', 36, true);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId || '')) {
    throw new Error('MANAGER_TABLE_COMMAND_ID_INVALID');
  }
  result.command_id = commandId;
  return result;
}

export function validateManagerTableManagementRequest(input: unknown): ManagerTableManagementRequest {
  const value = record(input);
  if (!value || value.action !== 'manager_table_management' || typeof value.operation !== 'string'
    || typeof value.table !== 'string' || !TABLES.has(value.table as ManagerTableKey)
    || !OPERATIONS.has(value.operation as ManagerTableOperation)) throw new Error('MANAGER_TABLE_QUERY_INVALID');
  const operation = value.operation as ManagerTableOperation;
  const table = value.table as ManagerTableKey;
  if (READ_ONLY_TABLES.has(table) && !['read', 'users'].includes(operation)) throw new Error('MANAGER_TABLE_READ_ONLY');
  if (!['company-directory', 'inquiry-coverage'].includes(table) && operation !== 'read' && operation !== 'users') {
    throw new Error('MANAGER_TABLE_OPERATION_FORBIDDEN');
  }
  const source = record(value.payload) || {};
  if (Object.keys(source).length > 16) throw new Error('MANAGER_TABLE_PAYLOAD_INVALID');
  return { operation, table, payload: cleanPayload(table, operation, source) };
}

export async function executeManagerTableManagement(
  client: { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message?: string } | null }> },
  actorId: string,
  input: unknown,
) {
  const request = validateManagerTableManagementRequest(input);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actorId)) {
    throw new Error('MANAGER_TABLE_ACTOR_INVALID');
  }
  if (READ_ONLY_TABLES.has(request.table)) throw new Error('MANAGER_TABLE_READ_ONLY_SOURCE');
  const { data, error } = await client.rpc('manager_table_management_v2397', {
    p_actor_id: actorId,
    p_operation: request.operation,
    p_table: request.table,
    p_payload: request.payload,
  });
  if (error) throw Object.assign(new Error(error.message || 'MANAGER_TABLE_UNAVAILABLE'), { code: error.code || '' });
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('MANAGER_TABLE_RESPONSE_INVALID');
  return data as Record<string, unknown>;
}
