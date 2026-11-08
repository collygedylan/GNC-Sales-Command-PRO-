import { applyUiState, clearPrepaintTheme, getRememberedDevicePreferences, normalizePreferenceUserKey, normalizePreferences, readCachedPreferences, timestampIsNewer, writeCachedPreferences } from './ops-pilot-appearance.js';
import { installControlHandlers, installMutationObserver, requestPreferenceSave } from './ops-pilot-collections.js';
import { deactivate, installRuntimeHealthMonitoring } from './ops-pilot-layout.js';
import { initializeMonitoring } from './ops-pilot-monitoring.js';
import { shared } from './ops-pilot-state.js';

export async function initialize(options) {
    const serial = ++shared.initializeSerial;
    shared.bridge = options && typeof options === 'object' ? options : null;
    const userKey = normalizePreferenceUserKey(shared.bridge && typeof shared.bridge.getUserKey === 'function' ? shared.bridge.getUserKey() : shared.state.userKey);
    if (userKey) shared.state.userKey = userKey;
    installControlHandlers();
    installMutationObserver();
    if (!shared.bridge || typeof shared.bridge.request !== 'function') {
      deactivate();
      clearPrepaintTheme();
      return false;
    }
    try {
      const response = await shared.bridge.request('get_user_preferences', {});
      if (serial !== shared.initializeSerial) return false;
      if (!response || response.ok !== true) {
        deactivate();
        clearPrepaintTheme();
        return false;
      }
      const flags = response.flags && typeof response.flags === 'object' ? response.flags : {};
      const appearanceEligible = response.eligible === true;
      const monitoringEligible = response.monitoringEligible === true && !!(response.monitoring && response.monitoring.dsn);
      const serverPreferences = appearanceEligible ? normalizePreferences(response.preferences) : getRememberedDevicePreferences();
      const cached = appearanceEligible ? readCachedPreferences(shared.state.userKey) : null;
      const useDirtyCache = !!(appearanceEligible && cached && cached.dirty && timestampIsNewer(cached.updatedAt, serverPreferences.updatedAt));
      shared.state.eligible = appearanceEligible;
      shared.state.userKey = userKey;
      shared.state.monitoringEligible = monitoringEligible;
      shared.state.flags = {
        skin: flags.skin === true,
        preferences: appearanceEligible && flags.preferences === true,
        card_grid: appearanceEligible && flags.card_grid === true,
        monitoring: monitoringEligible
      };
      shared.state.preferences = useDirtyCache ? normalizePreferences(cached) : serverPreferences;
      shared.state.activeView = String(shared.bridge.getActiveView && shared.bridge.getActiveView() || 'home').trim().toLowerCase() || 'home';
      shared.state.initialized = true;
      shared.state.provisional = false;
      if (appearanceEligible) writeCachedPreferences(shared.state.preferences, useDirtyCache);
      applyUiState();
      clearPrepaintTheme();
      if (useDirtyCache) requestPreferenceSave();
      if (monitoringEligible) initializeMonitoring(response.monitoring);
      installRuntimeHealthMonitoring();
      return appearanceEligible || monitoringEligible;
    } catch {
      if (serial === shared.initializeSerial && !shared.state.provisional) deactivate();
      return false;
    }
  }

