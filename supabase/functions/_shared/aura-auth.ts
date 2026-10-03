export function auraInventoryV2ProfileMatches(
  session: { authUserId?: string | null; username?: string | null } | null | undefined,
  profile: Record<string, unknown> | null | undefined,
) {
  const normalize = (value: unknown) => String(value || "").trim().toLowerCase().replace(/@.*$/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return Boolean(session?.authUserId && normalize(session.username || "") === "dylan_collyge"
    && profile?.id && String(profile.id) === String(session.authUserId)
    && !profile.disabled_at && profile.is_active !== false && profile.must_change_password !== true
    && normalize(String(profile.username || "")) === "dylan_collyge");
}
