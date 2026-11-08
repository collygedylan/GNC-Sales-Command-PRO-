import { applyUiState, getEffectiveDisplayMode, getEffectiveTheme, schedulePremiumDecorations } from './ops-pilot-appearance.js';
import { installMutationObserver, requestPreferenceSave, scheduleCompactBrowseRails } from './ops-pilot-collections.js';
import { primeCachedAppearance, scheduleLayoutHealthCheck, setActiveView } from './ops-pilot-layout.js';
import { RELEASE, shared } from './ops-pilot-state.js';
import { initialize } from './ops-pilot-lifecycle.js';
import { captureFailure, captureHealth, observeToast, recordPerformance } from './ops-pilot-monitoring.js';

'use strict';

if (document.body) document.body.classList.add('ops-precision-pilot', 'ag-premium-skin', 'premium-skin-v16');

window.addEventListener('resize', () => {
    applyUiState();
    scheduleCompactBrowseRails();
    scheduleLayoutHealthCheck('resize');
  }, { passive: true });

window.addEventListener('online', () => requestPreferenceSave(), { passive: true });

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      schedulePremiumDecorations();
      installMutationObserver();
      scheduleCompactBrowseRails();
    }, { once: true });
  } else {
    schedulePremiumDecorations();
    installMutationObserver();
    scheduleCompactBrowseRails();
  }

window.__gncOpsPilot = Object.freeze({
    release: RELEASE,
    initialize,
    primeCachedAppearance,
    setActiveView,
    captureFailure,
    captureHealth,
    observeToast,
    recordPerformance,
    applyUiState,
    getState() {
      return {
        initialized: shared.state.initialized,
        provisional: shared.state.provisional,
        eligible: shared.state.eligible,
        userKey: shared.state.userKey,
        monitoringEligible: shared.state.monitoringEligible,
        flags: { ...shared.state.flags },
        preferences: { ...shared.state.preferences },
        activeView: shared.state.activeView,
        effectiveDisplayMode: getEffectiveDisplayMode(),
        effectiveTheme: getEffectiveTheme(),
        monitoringReady: shared.monitoringReady
      };
    }
  });

