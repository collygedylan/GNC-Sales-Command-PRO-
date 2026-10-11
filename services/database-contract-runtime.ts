export type Json = null | boolean | number | string | Json[] | { [key: string]: Json | undefined };
export type Schema = 'null' | 'string' | 'number' | 'boolean' | 'never' | 'json'
  | { literal: string | number | boolean } | { array: Schema } | { oneOf: Schema[] }
  | { object: Record<string, { schema: Schema; optional?: boolean }> };
type DatabaseShape = { public: { Tables: object; Views: object; Functions: object } };
export type RuntimeContracts<D extends DatabaseShape> = {
  tables: { [T in keyof D['public']['Tables'] | keyof D['public']['Views']]: { row: Schema; insert: Schema; update: Schema } };
  functions: { [F in keyof D['public']['Functions']]: Schema };
  functionReturns: { [F in keyof D['public']['Functions']]: Schema };
};
export function isJson(value: unknown): value is Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  return typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
    && Object.values(value).every(entry => entry === undefined || isJson(entry));
}
export function matchesSchema(schema: Schema, input: unknown): boolean {
  if (schema === 'json') return isJson(input);
  if (schema === 'never') return false;
  if (schema === 'null') return input === null;
  if (typeof schema === 'string') return typeof input === schema && (schema !== 'number' || Number.isFinite(input));
  if ('literal' in schema) return input === schema.literal;
  if ('oneOf' in schema) return schema.oneOf.some(variant => matchesSchema(variant, input));
  if ('array' in schema) return Array.isArray(input) && input.every(value => matchesSchema(schema.array, value));
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(input));
  return Object.keys(record).every(key => Object.prototype.hasOwnProperty.call(schema.object, key)) && Object.entries(schema.object)
    .every(([key, field]) => record[key] === undefined ? Boolean(field.optional) : matchesSchema(field.schema, record[key]));
}
export function validateSchema(schema: Schema, input: unknown, label: string): void {
  if (!matchesSchema(schema, input)) throw new Error(`Invalid ${label}: fields and values must match the database schema.`);
}
export function jsonValue(input: unknown): Json {
  if (!isJson(input)) throw new Error('Expected a finite JSON value.');
  return input;
}
export function jsonObject(input: unknown): Record<string, Json | undefined> {
  if (!isJson(input) || !input || Array.isArray(input) || typeof input !== 'object') throw new Error('Expected a JSON object.');
  return input;
}
