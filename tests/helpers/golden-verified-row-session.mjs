export function verifiedRowSession(actor = 'fixture_editor') {
  const profile = { id: 'fixture-profile', username: actor, role: 'EVAL', active: true };
  const matrix = { username: actor, profile_id: profile.id, verified: true, role: 'EVAL',
    edit_assigned_rows_only: 'Y', edit_any_row: 'N', view_permissions: { view_que: 'Y', view_drive_mode: 'Y' } };
  return {
    currentUser: actor, currentRole: 'EVAL', nativeAuthSessionActive: true,
    nativeAuthSessionUserId: profile.id, nativeAuthProfile: profile,
    resolveUserAccessMatrix: () => matrix,
    getCardEvalOwnerIndex: () => ({ exact: new Map(), family: new Map() }),
    getManagerAssignedColumnState: () => ({}),
    buildManagerEvalAssignmentKey: value => String(value || '').trim().toUpperCase(),
    requestCapabilityState: { stale: false, status: 'ready', username: actor, profileId: profile.id,
      capabilities: { canViewQueue: true, canTakePhoto: true, canEdit: true, canComplete: true } },
  };
}
