import type { Database } from './sandbox.database.types';
import { contracts } from './sandbox-contracts.generated';
import { validateSchema } from '../../../services/database-contract-runtime';

export function sandboxUpdate<T extends keyof Database['public']['Tables']>(table: T, input: unknown): Database['public']['Tables'][T]['Update'] {
  validateSchema(contracts.tables[table].update, input, `${table} update`);
  // The generated validator checks every key, nullability and value before this
  // boundary narrows unknown data into the matching generated Update contract.
  return input as Database['public']['Tables'][T]['Update'];
}
