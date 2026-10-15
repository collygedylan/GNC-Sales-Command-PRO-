const objectKeys = new WeakMap();
let nextObjectKey = 0;

/** Prefer the database identity; malformed transient rows still never borrow a list position.
 * @param {object} row @param {unknown} id @returns {string}
 */
export function renderIdentity(row, id) {
  const identity = String(id ?? '').trim();
  if (identity) return identity;
  if (!objectKeys.has(row)) objectKeys.set(row, `transient-row:${++nextObjectKey}`);
  return objectKeys.get(row);
}
