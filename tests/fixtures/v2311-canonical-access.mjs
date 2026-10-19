const SYNTHETIC_AUTH_PROFILE_ID = '54c87ebf-d76d-452b-96b4-beaaeb1742d9';

const PERMISSION_KEYS = Object.freeze([
  'can_access_drive_mode', 'can_access_av', 'can_access_que', 'can_access_manager_tab',
  'can_manage_user_access', 'can_access_eval_reports_2', 'can_submit_reclass',
  'can_complete_suspend_tag', 'can_approve_deny_suspend'
]);

const clone = value => JSON.parse(JSON.stringify(value));
const normalizeUsername = value => String(value ?? '').trim().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const cleanPermissions = value => Object.fromEntries(PERMISSION_KEYS.map(key => [key, value?.[key] === true]));
const cleanOverrides = value => Object.fromEntries(PERMISSION_KEYS.map(key => [key, typeof value?.[key] === 'boolean' ? value[key] : null]));
const effectivePermissions = (baseline, overrides) => Object.fromEntries(PERMISSION_KEYS.map(key => [
  key, typeof overrides?.[key] === 'boolean' ? overrides[key] : baseline?.[key] === true
]));
const ROLE_ALIASES = Object.freeze({
  admin: ['admin', 'administrator', 'superadmin', 'super admin'], manager: ['manager'],
  supervisor: ['supervisor', 'data entry supervisor', 'data-entry supervisor'],
  sales_rep: ['rep', 'sales rep', 'sales_rep', 'salesrep', 'sales', 'sale'],
  evaluator: ['eval', 'evaluator', 'evaluation'], counter: ['qc'], kier: ['kier'],
  dock_office: ['dock office', 'dock/office', 'office', 'dock'],
  qc_supervisor: ['qc supervisor', 'qc-supervisor', 'qcsupervisor', 'qcsup'],
  csr: ['csr', 'customer service representative'], data_entry: ['data entry', 'data-entry'],
  foreman: ['foreman'], grower: ['grower'], take_backs: ['take back', 'takeback', 'take backs', 'takebacks'],
});
const normalizeRole = value => {
  const role = String(value ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  return Object.entries(ROLE_ALIASES).find(([, aliases]) => aliases.some(alias => alias.replace(/[_-]+/g, ' ') === role))?.[0] || '';
};

// Test-only authoritative snapshots copied from the matching SQL seed contract.
// These values do not grant real access and are never installed outside the
// isolated synthetic native-auth test fixture.
export const V2311_TEST_ROLE_BASELINES = Object.freeze({
  admin: { can_access_drive_mode: true, can_access_av: true, can_access_que: true, can_access_manager_tab: true, can_manage_user_access: true, can_access_eval_reports_2: false, can_submit_reclass: true, can_complete_suspend_tag: false, can_approve_deny_suspend: false },
  manager: { can_access_drive_mode: true, can_access_av: true, can_access_que: true, can_access_manager_tab: true, can_manage_user_access: true, can_access_eval_reports_2: false, can_submit_reclass: true, can_complete_suspend_tag: false, can_approve_deny_suspend: false },
  supervisor: { can_access_drive_mode: true, can_access_av: true, can_access_que: true, can_access_manager_tab: false, can_manage_user_access: false, can_access_eval_reports_2: false, can_submit_reclass: true, can_complete_suspend_tag: false, can_approve_deny_suspend: false },
  sales_rep: { can_access_drive_mode: true, can_access_av: true, can_access_que: true, can_access_manager_tab: false, can_manage_user_access: false, can_access_eval_reports_2: false, can_submit_reclass: false, can_complete_suspend_tag: false, can_approve_deny_suspend: true },
  evaluator: { can_access_drive_mode: true, can_access_av: true, can_access_que: true, can_access_manager_tab: false, can_manage_user_access: false, can_access_eval_reports_2: false, can_submit_reclass: true, can_complete_suspend_tag: false, can_approve_deny_suspend: false },
  counter: { can_access_drive_mode: true, can_access_av: false, can_access_que: true, can_access_manager_tab: false, can_manage_user_access: false, can_access_eval_reports_2: false, can_submit_reclass: false, can_complete_suspend_tag: false, can_approve_deny_suspend: false },
  kier: { can_access_drive_mode: true, can_access_av: true, can_access_que: true, can_access_manager_tab: false, can_manage_user_access: false, can_access_eval_reports_2: false, can_submit_reclass: true, can_complete_suspend_tag: false, can_approve_deny_suspend: false },
  dock_office: { can_access_drive_mode: true, can_access_av: true, can_access_que: true, can_access_manager_tab: false, can_manage_user_access: false, can_access_eval_reports_2: false, can_submit_reclass: true, can_complete_suspend_tag: false, can_approve_deny_suspend: false },
  qc_supervisor: { can_access_drive_mode: true, can_access_av: false, can_access_que: true, can_access_manager_tab: false, can_manage_user_access: false, can_access_eval_reports_2: false, can_submit_reclass: true, can_complete_suspend_tag: false, can_approve_deny_suspend: false },
  csr: { can_access_drive_mode: true, can_access_av: true, can_access_que: true, can_access_manager_tab: false, can_manage_user_access: false, can_access_eval_reports_2: false, can_submit_reclass: false, can_complete_suspend_tag: false, can_approve_deny_suspend: false },
  data_entry: { can_access_drive_mode: true, can_access_av: true, can_access_que: true, can_access_manager_tab: false, can_manage_user_access: false, can_access_eval_reports_2: false, can_submit_reclass: true, can_complete_suspend_tag: false, can_approve_deny_suspend: false },
  foreman: { can_access_drive_mode: true, can_access_av: false, can_access_que: true, can_access_manager_tab: false, can_manage_user_access: false, can_access_eval_reports_2: false, can_submit_reclass: true, can_complete_suspend_tag: false, can_approve_deny_suspend: false },
  grower: { can_access_drive_mode: false, can_access_av: false, can_access_que: true, can_access_manager_tab: false, can_manage_user_access: false, can_access_eval_reports_2: false, can_submit_reclass: true, can_complete_suspend_tag: false, can_approve_deny_suspend: false },
  take_backs: { can_access_drive_mode: false, can_access_av: false, can_access_que: true, can_access_manager_tab: false, can_manage_user_access: false, can_access_eval_reports_2: false, can_submit_reclass: true, can_complete_suspend_tag: false, can_approve_deny_suspend: false },
});

/**
 * In-memory fixture for the canonical user-access API. It is deliberately
 * installed only on a Playwright page using the synthetic native profile;
 * no production data writes, credentials, or email calls are possible.
 */
export function createV2311CanonicalAccessFixture({ username = 'dylan_collyge', role = 'admin', revision = 1,
  roleBaselines = [], users = [] } = {}) {
  const actorUsername = normalizeUsername(username);
  const suppliedBaselines = roleBaselines.length ? roleBaselines : Object.entries(V2311_TEST_ROLE_BASELINES).map(([roleKey, permissions]) => ({ role: roleKey, permissions }));
  const baselines = new Map(suppliedBaselines.map(row => [normalizeRole(row.role) || String(row.role).trim().toLowerCase(), cleanPermissions(row.permissions)]));
  const canonicalActorRole = normalizeRole(role) || String(role).trim().toLowerCase();
  const seededOverrides = Object.fromEntries(PERMISSION_KEYS.map(key => [key, null]));
  if (['dylan_collyge', 'megan_kelly', 'jd_jones'].includes(actorUsername)) seededOverrides.can_access_eval_reports_2 = true;
  const normalizedInputUsers = users.length ? users : [{ id: SYNTHETIC_AUTH_PROFILE_ID, username: actorUsername,
    display_name: username, role, active: true, salesrep_match_names: [],
    baseline: { role: canonicalActorRole, permissions: baselines.get(canonicalActorRole) || {} }, permission_overrides: seededOverrides }];
  const directoryUsers = normalizedInputUsers.map(row => ({
    ...clone(row), username: normalizeUsername(row.username), active: row.active === true,
    id: row.active === true && row.id ? String(row.id) : '',
    permission_overrides: cleanOverrides(row.permission_overrides),
    baseline: { role: normalizeRole(row.baseline?.role || row.role) || String(row.baseline?.role || row.role || '').trim().toLowerCase(),
      permissions: cleanPermissions(row.baseline?.permissions || baselines.get(normalizeRole(row.baseline?.role || row.role) || String(row.role || '').trim().toLowerCase())) },
  }));
  const actor = directoryUsers.find(row => row.username === actorUsername && row.active === true);
  if (!actor) throw new Error(`Synthetic canonical fixture requires an active actor profile for ${actorUsername}.`);
  const state = { revision: Math.max(1, Number(revision) || 1), actorUsername, baselines, users: directoryUsers, calls: [], blocked: [] };
  const actorPermissions = () => effectivePermissions(actor.baseline.permissions, actor.permission_overrides);
  const profileFor = row => ({ id: row.id, username: row.username, display_name: row.display_name || row.username,
    role: row.role, email: row.email || null, salesrep_id: row.salesrep_id || null,
    salesrep_match_names: Array.isArray(row.salesrep_match_names) ? row.salesrep_match_names : [] });
  const userFor = row => ({ ...profileFor(row), active: row.active === true,
    baseline: { role: row.baseline.role, permissions: cleanPermissions(row.baseline.permissions), revision: state.revision },
    permission_overrides: cleanOverrides(row.permission_overrides),
    effective_permissions: effectivePermissions(row.baseline.permissions, row.permission_overrides),
    access_revision: state.revision });

  return {
    permissionKeys: PERMISSION_KEYS,
    state,
    async handle(route, origin) {
      const request = route.request();
      const headers = request.headers();
      const body = request.postDataJSON() || {};
      const json = async (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload), headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': headers['access-control-request-headers'] || 'authorization, apikey, content-type, x-client-info',
        'access-control-allow-credentials': 'true',
      } });
      if (request.method() === 'OPTIONS') return json({}, 204);
      if (request.method() !== 'POST' || body.action !== 'user_access') return route.fallback();
      const token = String(headers.authorization || '').match(/^Bearer\s+(\S+)$/i)?.[1] || '';
      let tokenSubject = '';
      try {
        tokenSubject = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8')).sub || '';
      } catch { /* An invalid synthetic token is denied by the fixture. */ }
      if (!token || tokenSubject !== actor.id || actor.id !== SYNTHETIC_AUTH_PROFILE_ID) {
        state.blocked.push({ operation: String(body.operation || ''), reason: 'missing synthetic session binding' });
        return json({ ok: false, error: 'ACTIVE_PROFILE_REQUIRED', status: 401 }, 401);
      }

      const operation = String(body.operation || '').trim();
      state.calls.push({ operation, actor: actorUsername, expectedRevision: Number(body.expected_revision) || null });
      if (operation === 'resolve') {
        const permissions = actorPermissions();
        const roleKey = actor.baseline.role;
        return json({ ok: true, data: { revision: state.revision, profile: profileFor(actor),
          baseline: { role: roleKey, permissions: cleanPermissions(actor.baseline.permissions), revision: state.revision },
          permission_overrides: cleanOverrides(actor.permission_overrides), effective_permissions: permissions,
          data_hydration_policy: { use_shared_instant_snapshot: true, av_season_rule: 'current-season-salesyear', av_visibility_rule: 'open-stock-or-owned-reserve' },
          resolved_at: new Date().toISOString() } });
      }
      if (!actorPermissions().can_manage_user_access) return json({ ok: false, error: 'USER_ACCESS_FORBIDDEN', status: 403 }, 403);
      if (operation === 'directory') return json({ ok: true, data: { revision: state.revision,
        role_baselines: [...state.baselines].map(([roleKey, permissions]) => ({ role: roleKey, permissions: cleanPermissions(permissions), revision: state.revision })),
        users: state.users.map(userFor) } });
      if (!Number.isInteger(Number(body.expected_revision)) || Number(body.expected_revision) !== state.revision
        || !/^[0-9a-f-]{36}$/i.test(String(body.command_id || ''))) {
        return json({ ok: false, error: 'USER_ACCESS_REVISION_CONFLICT', status: 409 }, 409);
      }
      if (operation === 'save_role_baseline') {
        const roleKey = String(body.role || '').trim().toLowerCase();
        if (!state.baselines.has(roleKey) || !body.permissions || !PERMISSION_KEYS.every(key => typeof body.permissions[key] === 'boolean')) {
          return json({ ok: false, error: 'USER_ACCESS_INVALID_COMMAND', status: 400 }, 400);
        }
        const permissions = cleanPermissions(body.permissions);
        state.baselines.set(roleKey, permissions);
        state.users.filter(row => row.baseline.role === roleKey).forEach(row => { row.baseline.permissions = permissions; });
        state.revision++;
        return json({ ok: true, data: { revision: state.revision, baseline: { role: roleKey, permissions, revision: state.revision } } });
      }
      if (operation === 'save_user_overrides') {
        const target = state.users.find(row => row.username === normalizeUsername(body.username) && row.active === true && row.id);
        const incoming = body.permission_overrides;
        if (!target || !incoming || typeof incoming !== 'object' || !PERMISSION_KEYS.every(key => incoming[key] === null || typeof incoming[key] === 'boolean')) {
          return json({ ok: false, error: 'USER_ACCESS_INVALID_COMMAND', status: 400 }, 400);
        }
        target.permission_overrides = cleanOverrides(incoming);
        state.revision++;
        return json({ ok: true, data: { revision: state.revision, user: userFor(target) } });
      }
      state.blocked.push({ operation, reason: 'unsupported canonical operation' });
      return json({ ok: false, error: 'USER_ACCESS_INVALID_COMMAND', status: 400 }, 400);
    },
  };
}

export function installV2311CanonicalAccessRoute(page, baseURL, fixture) {
  const origin = new URL(baseURL).origin;
  return page.route('**/functions/v1/app-api*', route => fixture.handle(route, origin));
}

export function createDefaultV2311CanonicalAccessFixture(options = {}) {
  return createV2311CanonicalAccessFixture(options);
}

