import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.3";
import type { Database } from "./database.types.ts";
import { normalizeUsername } from "./app-auth.ts";
import { requestRecipientDirectoryFromResult, type RequestRecipient, type RequestRecipientDirectory } from "../../../services/requestRecipients.ts";

type Profile = Pick<Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "legacy_user_id" | "username" | "display_name" | "role" | "disabled_at">;
type LegacyUser = Pick<Database["public"]["Tables"]["ph_app_users"]["Row"],
  "id" | "username" | "role" | "disabled_at">;

// Union of the existing Bloom Crop Update and Request Details email permissions.
export function isRequestRecipientDirectoryUser(username: unknown): boolean {
  return typeof username === "string" && ["dylan_collyge", "jd_jones", "megan_kelly"].includes(username);
}

function identity(value: unknown): string {
  if (typeof value !== "string" || value.length > 160) throw new Error("RECIPIENT_DIRECTORY_INVALID_ROW");
  const username = normalizeUsername(value);
  if (!username || !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(username)) throw new Error("RECIPIENT_DIRECTORY_INVALID_ROW");
  return username;
}

function recipient(username: string, displayName: unknown, role: unknown): RequestRecipient {
  if (typeof role !== "string" || role.length > 160
    || (displayName !== null && typeof displayName !== "string")) throw new Error("RECIPIENT_DIRECTORY_INVALID_ROW");
  const display = typeof displayName === "string" && displayName.trim()
    ? displayName.trim() : username.split("_").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  if (display.length > 240) throw new Error("RECIPIENT_DIRECTORY_INVALID_ROW");
  return { username, displayName: display, role };
}

/** Profiles own account activity; an active legacy row cannot revive a disabled profile. */
export function mergeRequestRecipients(profiles: readonly Profile[], legacyUsers: readonly LegacyUser[]): RequestRecipient[] {
  const result = new Map<string, RequestRecipient>();
  const profileNames = new Set<string>();
  const disabledNames = new Set<string>();
  const linkedLegacyIds = new Set<number>();
  for (const profile of profiles) {
    const username = identity(profile.username);
    if (profile.disabled_at !== null && typeof profile.disabled_at !== "string") throw new Error("RECIPIENT_DIRECTORY_INVALID_ROW");
    if (profile.legacy_user_id !== null) {
      if (!Number.isSafeInteger(profile.legacy_user_id)) throw new Error("RECIPIENT_DIRECTORY_INVALID_ROW");
      linkedLegacyIds.add(profile.legacy_user_id);
    }
    profileNames.add(username);
    if (profile.disabled_at !== null) { disabledNames.add(username); result.delete(username); continue; }
    if (!disabledNames.has(username) && !result.has(username)) result.set(username, recipient(username, profile.display_name, profile.role));
  }
  for (const legacy of legacyUsers) {
    const username = identity(legacy.username);
    if (!Number.isSafeInteger(legacy.id) || (legacy.disabled_at !== null && typeof legacy.disabled_at !== "string")) {
      throw new Error("RECIPIENT_DIRECTORY_INVALID_ROW");
    }
    if (linkedLegacyIds.has(legacy.id) || profileNames.has(username)) continue;
    if (legacy.disabled_at !== null) { disabledNames.add(username); result.delete(username); continue; }
    if (disabledNames.has(username) || result.has(username)) continue;
    result.set(username, recipient(username, null, legacy.role));
  }
  return [...result.values()].sort((a, b) => a.username.localeCompare(b.username, "en"));
}

export async function readRequestRecipientDirectory(client: SupabaseClient<Database>): Promise<RequestRecipientDirectory> {
  const profiles: Profile[] = [];
  const legacyUsers: LegacyUser[] = [];
  // Keep projections fixed, page both sources, and fail rather than return a silently truncated directory.
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    if (offset >= 10000) throw new Error("RECIPIENT_DIRECTORY_LIMIT");
    const { data, error } = await client.from("profiles")
      .select("id,legacy_user_id,username,display_name,role,disabled_at").order("id").range(offset, offset + pageSize - 1);
    if (error || !data) throw new Error("RECIPIENT_DIRECTORY_UNAVAILABLE");
    profiles.push(...data);
    if (data.length < pageSize) break;
  }
  for (let offset = 0; ; offset += pageSize) {
    if (offset >= 10000) throw new Error("RECIPIENT_DIRECTORY_LIMIT");
    const { data, error } = await client.from("ph_app_users")
      .select("id,username,role,disabled_at").order("id").range(offset, offset + pageSize - 1);
    if (error || !data) throw new Error("RECIPIENT_DIRECTORY_UNAVAILABLE");
    legacyUsers.push(...data);
    if (data.length < pageSize) break;
  }
  const users = mergeRequestRecipients(profiles, legacyUsers);
  const bytes = new TextEncoder().encode(JSON.stringify(users));
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  return requestRecipientDirectoryFromResult({ ok: true, revision: `recipients-v1:${digest}`, users });
}
