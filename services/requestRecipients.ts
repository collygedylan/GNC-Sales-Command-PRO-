export interface RequestRecipient {
  username: string;
  displayName: string;
  role: string;
}

export interface RequestRecipientDirectory {
  ok: true;
  revision: string;
  users: RequestRecipient[];
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The legacy UI receives only validated display identities, never account data. */
export function requestRecipientDirectoryFromResult(value: unknown): RequestRecipientDirectory {
  const invalid = () => new Error('Recipient directory is unavailable. Retry loading recipients.');
  if (!record(value) || value.ok !== true || typeof value.revision !== 'string'
    || !/^recipients-v1:[a-f0-9]{64}$/.test(value.revision)
    || !Array.isArray(value.users) || value.users.length > 10000) throw invalid();
  const seen = new Set<string>();
  const users = value.users.map((entry): RequestRecipient => {
    if (!record(entry) || typeof entry.username !== 'string'
      || !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(entry.username) || entry.username.length > 160
      || typeof entry.displayName !== 'string' || !entry.displayName.trim() || entry.displayName.length > 240
      || typeof entry.role !== 'string' || entry.role.length > 160
      || seen.has(entry.username)) throw invalid();
    seen.add(entry.username);
    return { username: entry.username, displayName: entry.displayName, role: entry.role };
  });
  return { ok: true, revision: value.revision, users };
}
