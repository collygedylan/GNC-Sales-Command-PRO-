import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.3";
import type { Database } from "./database.types.ts";

export const CANONICAL_USER_ACCESS_FLAGS = [
  "can_access_drive_mode", "can_access_av", "can_access_que", "can_access_manager_tab",
  "can_manage_user_access", "can_access_eval_reports_2", "can_submit_reclass",
  "can_complete_suspend_tag", "can_approve_deny_suspend",
] as const;

export type CanonicalUserAccessFlag = typeof CANONICAL_USER_ACCESS_FLAGS[number];
export type CanonicalUserAccess = {
  revision: number;
  username: string;
  canonicalRole: string;
  permissions: Record<CanonicalUserAccessFlag, boolean>;
};

type RpcClient = Pick<SupabaseClient<Database>, "rpc">;
type JsonRecord = Record<string, unknown>;

export const FULL_APP_ADMINISTRATORS = new Set(["dylan_collyge", "megan_kelly", "jd_jones"]);
export function isCanonicalAuraOwner(username: unknown): boolean {
  return typeof username === "string" && username.trim().toLowerCase() === "dylan_collyge";
}
export function enforceCanonicalAccountPermissions(username: string, permissions: Record<CanonicalUserAccessFlag, boolean>) {
  const fullAccess = FULL_APP_ADMINISTRATORS.has(username.trim().toLowerCase());
  return Object.fromEntries(CANONICAL_USER_ACCESS_FLAGS.map(flag => [flag,
    flag === "can_manage_user_access" ? fullAccess : fullAccess || permissions[flag],
  ])) as Record<CanonicalUserAccessFlag, boolean>;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

/** Resolves flags only for a profile obtained from resolveActiveSessionProfile. */
export async function resolveCanonicalUserAccess(db: RpcClient, actorProfileId: string): Promise<CanonicalUserAccess> {
  if (!actorProfileId.trim()) throw new Error("USER_ACCESS_PROFILE_REQUIRED");
  const rpc = db.rpc.bind(db) as unknown as (name: string, args: JsonRecord) => Promise<{ data: unknown; error: unknown }>;
  const { data, error } = await rpc("user_access_command_v1", {
    p_actor_profile_id: actorProfileId,
    p_operation: "resolve",
    p_payload: {},
  });
  if (error) throw error;
  const envelope = record(data);
  if (!envelope || envelope.ok === false) throw new Error(String(envelope?.code || envelope?.error || "USER_ACCESS_RESOLVE_FAILED"));
  const resolved = record(envelope.data) || envelope;
  const profile = record(resolved.profile);
  if (profile?.id !== actorProfileId || typeof profile.username !== "string") throw new Error("USER_ACCESS_IDENTITY_MISMATCH");
  const baseline = record(resolved.baseline);
  const username = profile.username.trim().toLowerCase();
  const canonicalRole = String(baseline?.role || "").trim().toLowerCase();
  if (!username || !canonicalRole) throw new Error("USER_ACCESS_IDENTITY_MISMATCH");
  const source = record(resolved.effective_permissions || resolved.effectivePermissions);
  if (!source) throw new Error("USER_ACCESS_PERMISSION_SNAPSHOT_INVALID");
  const permissions = {} as Record<CanonicalUserAccessFlag, boolean>;
  for (const flag of CANONICAL_USER_ACCESS_FLAGS) {
    if (typeof source[flag] !== "boolean") throw new Error("USER_ACCESS_PERMISSION_SNAPSHOT_INVALID");
    permissions[flag] = source[flag] as boolean;
  }
  const revision = Number(resolved.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("USER_ACCESS_REVISION_INVALID");
  return { revision, username, canonicalRole, permissions: enforceCanonicalAccountPermissions(username, permissions) };
}

export function requireCanonicalUserAccessFlag(access: CanonicalUserAccess, flag: CanonicalUserAccessFlag): void {
  if (access.permissions[flag] !== true) throw new Error(`USER_ACCESS_FORBIDDEN:${flag}`);
}

export function hasAnyCanonicalUserAccessFlag(access: CanonicalUserAccess, flags: readonly CanonicalUserAccessFlag[]): boolean {
  return flags.some(flag => access.permissions[flag] === true);
}

