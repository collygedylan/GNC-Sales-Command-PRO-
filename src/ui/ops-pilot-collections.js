import { BROWSE_RAIL_SELECTOR, LIST_ROOT_IDS, LIST_VIEWS, RECORD_CLASS_PATTERN, compactBrowseRailOpenState, compactBrowseRailState, shared } from './ops-pilot-state.js';
import { applyUiState, getEffectiveDisplayMode, gridIsSupportedHere, nextPreferenceTimestamp, normalizeDisplayMode, normalizePreferences, normalizeThemeMode, readCachedPreferences, schedulePremiumDecorations, writeCachedPreferences } from './ops-pilot-appearance.js';
import { scheduleLayoutHealthCheck } from './ops-pilot-layout.js';

export function isRecordNode(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.matches('form, fieldset, [role="dialog"], .hidden')) return false;
    if (element.closest('#manager-approval-detail-workspace, #view-chat, [role="dialog"], form')) return false;
    const className = String(element.className || '');
    if (RECORD_CLASS_PATTERN.test(className)) return true;
    if (element.matches('button[onclick], article[onclick], div[onclick]') && /border|card|row/i.test(className)) return true;
    return false;
  }

export function decorateRecordCollections() {
    shared.decorateFrame = 0;
    if (!LIST_VIEWS.has(shared.state.activeView)) return;
    const rootId = LIST_ROOT_IDS[shared.state.activeView];
    const root = rootId ? document.getElementById(rootId) : null;
    if (!root) return;
    const previous = [root, ...root.querySelectorAll('.ops-record-collection, .ops-record-node')];
    const collections = new Set();
    const nodes = new Set();
    const candidates = [root, ...Array.from(root.querySelectorAll('div, section, ul')).slice(0, 500)];
    candidates.forEach((container) => {
      // Classify against this pass, not stale classes from the previous pass.
      if (nodes.has(container)) return;
      const mountedRecord = container !== root ? container.closest('.ops-record-node') : null;
      if (mountedRecord && nodes.has(mountedRecord)) return;
      for (let parent = container.parentElement; container !== root && parent && root.contains(parent); parent = parent.parentElement) {
        if (nodes.has(parent)) return;
      }
      const directChildren = Array.from(container.children || []).filter((child) => child instanceof HTMLElement);
      const recordChildren = directChildren.filter(isRecordNode);
      const qualifies = recordChildren.length >= 2 && recordChildren.length >= Math.ceil(directChildren.length * 0.6);
      if (qualifies) {
        collections.add(container);
        recordChildren.forEach((child) => nodes.add(child));
      }
    });
    // Mutation-driven chunks leave existing cards intact. Changing only the
    // affected classes avoids invalidating every card's styles on each batch.
    new Set([...previous, ...collections, ...nodes]).forEach((element) => {
      if (element.classList.contains('ops-record-collection') !== collections.has(element)) element.classList.toggle('ops-record-collection', collections.has(element));
      if (element.classList.contains('ops-record-node') !== nodes.has(element)) element.classList.toggle('ops-record-node', nodes.has(element));
    });
  }

export function scheduleDecorateRecordCollections() {
    if (shared.decorateFrame) return;
    const runDecoration = () => {
      shared.decorateFrame = 0;
      if (shouldDeferRecordCollectionDecoration({
        narrowOrTouch: isNarrowOrTouchLayout(),
        grid: getEffectiveDisplayMode() === 'grid',
        activeChunk: hasActiveProgressiveListChunk()
      })) return;
      decorateRecordCollections();
    };
    if (typeof window.requestIdleCallback === 'function') {
      shared.decorateFrame = window.requestIdleCallback(runDecoration, { timeout: 220 });
      return;
    }
    shared.decorateFrame = window.setTimeout(runDecoration, 48);
  }

export function isNarrowOrTouchLayout() {
    const width = Number(window.innerWidth || document.documentElement?.clientWidth || 0);
    const coarsePointer = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    return width <= 767 || coarsePointer;
  }

export function hasActiveProgressiveListChunk() {
    const rootId = LIST_ROOT_IDS[shared.state.activeView];
    const container = rootId ? document.getElementById(rootId) : null;
    return isProgressiveChunkContainerActive(container);
  }

function scheduleAddedPremiumNodes(record) {
    for (const node of Array.from(record.addedNodes || [])) {
        if (node && (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE)) schedulePremiumDecorations(node);
    }
}

function handlePilotMutations(records) {
    const relevant = records.filter(record => !record.target?.closest?.('[data-manager-assigned-desktop-table], [data-manager-assigned-mobile-list]'));
    if (!relevant.length) return;
    relevant.forEach(scheduleAddedPremiumNodes);
    scheduleDecorateRecordCollections();
    if (mutationAffectsCompactBrowseRails(relevant)) scheduleCompactBrowseRails();
    scheduleLayoutHealthCheck('mutation');
}

export function installMutationObserver() {
    if (shared.mutationObserver || !window.MutationObserver) return;
    const wrapper = document.getElementById('view-wrapper');
    if (!wrapper) return;
    shared.mutationObserver = new MutationObserver(handlePilotMutations);
    shared.mutationObserver.observe(wrapper, { childList: true, subtree: true });
}

export function isProgressiveChunkContainerActive(container) {
    return Number(container?.dataset?.activeChunkRenderToken || 0) > 0
      && String(container?.dataset?.activeChunkRenderKey || '').trim() !== '';
  }

export function shouldDeferRecordCollectionDecoration({ narrowOrTouch, grid, activeChunk }) {
    return narrowOrTouch === true && grid !== true && activeChunk === true;
  }

export function nodeTouchesCompactBrowseRail(node, includeDescendants = false) {
    const element = node && node.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (element && (element.matches(BROWSE_RAIL_SELECTOR) || Boolean(element.closest(BROWSE_RAIL_SELECTOR)))) return true;
    return includeDescendants && Boolean(node?.querySelector?.(BROWSE_RAIL_SELECTOR));
  }

export function mutationAffectsCompactBrowseRails(records) {
    return Array.from(records || []).some((record) => {
      if (nodeTouchesCompactBrowseRail(record.target)) return true;
      return [...Array.from(record.addedNodes || []), ...Array.from(record.removedNodes || [])]
        .some((node) => nodeTouchesCompactBrowseRail(node, true));
    });
  }

export function compactBrowseRailKey(rail) {
    const owner = rail.closest('[id]');
    const railName = rail.id || rail.getAttribute('aria-label') || Array.from(rail.classList).sort().join('.');
    return `${owner ? owner.id : ''}:${railName}`;
  }

function restoreCompactBrowseRail(rail, saved) {
    if (!saved || !saved.details.isConnected) return;
    saved.children.forEach(child => { if (child.isConnected) rail.appendChild(child); });
    if (saved.reportGrid && saved.report && saved.reportGrid.isConnected) saved.reportGrid.prepend(saved.report);
    saved.details.remove();
    rail.classList.remove('mobile-browse-rail');
    compactBrowseRailState.delete(rail);
}

function decorateCompactBrowseRail(rail,mobile) {
      // Eval2 mounts its closed disclosure synchronously and retains that DOM.
      if (rail.id === 'drive-toolbar-rail' || rail.matches('.manager-eval2-drive-controls')) return;
      const saved = compactBrowseRailState.get(rail);
      if (!mobile) { restoreCompactBrowseRail(rail, saved); return; }
      if (saved && saved.details.isConnected) return;
      const reportGrid = rail.matches('.manager-eval2-drive-controls') ? rail.querySelector(':scope > .manager-eval2-drive-filter-grid') : null;
      const report = reportGrid && reportGrid.firstElementChild;
      if (report && reportGrid.children.length > 1) rail.insertBefore(report, reportGrid);
      const children = Array.from(rail.children).filter((child) => !child.matches('.task-top-control-panel,.excel-filter-panel'));
      if (children.length < 3) return;
      const details = document.createElement('details');
      details.className = 'mobile-browse-filters';
      details.innerHTML = '<summary>Filters</summary><div class="mobile-browse-filter-panel"></div>';
      const railKey = compactBrowseRailKey(rail);
      details.open = compactBrowseRailOpenState.get(railKey) === true;
      details.addEventListener('toggle', () => compactBrowseRailOpenState.set(railKey, details.open));
      const summary = details.querySelector('summary');
      summary.addEventListener('click', () => {
        // `toggle` is queued after the native disclosure activation. Persist the
        // intended state immediately so a rail rebuild in that same task cannot
        // recreate the Filters panel with a stale, closed value.
        compactBrowseRailOpenState.set(railKey, !details.open);
      }, true);
      const panel = details.lastElementChild;
      children.slice(1).forEach((child) => panel.appendChild(child));
      rail.appendChild(details);
      rail.classList.add('mobile-browse-rail');
      compactBrowseRailState.set(rail, { children, details, reportGrid, report });
      shared.hasCompactBrowseRails = true;
 }

export function decorateCompactBrowseRails() {
    shared.compactBrowseRailFrame = 0;
    const mobile = window.innerWidth <= 767;
    // Desktop has nothing to restore until a mobile rail has been created.
    // Avoid a full selector scan after every unrelated card mutation.
    if (!mobile && !shared.hasCompactBrowseRails) return;
    document.querySelectorAll(BROWSE_RAIL_SELECTOR).forEach(rail => decorateCompactBrowseRail(rail,mobile));
    if (!mobile) shared.hasCompactBrowseRails = false;
  }

export function scheduleCompactBrowseRails() {
    if (shared.compactBrowseRailFrame) return;
    shared.compactBrowseRailFrame = window.requestAnimationFrame(decorateCompactBrowseRails);
  }

export function requestPreferenceSave() {
    if (!shared.state.eligible || (!shared.state.flags.preferences && !shared.state.flags.card_grid) || !shared.bridge || typeof shared.bridge.request !== 'function') return Promise.resolve(false);
    if (shared.preferenceSaveInFlight) return shared.preferenceSaveInFlight;
    const cached = readCachedPreferences();
    if (!cached || !cached.dirty) return Promise.resolve(true);
    const attemptedAt = cached.updatedAt;
    shared.preferenceSaveInFlight = shared.bridge.request('set_user_preferences', {
      preferences: {
        themeMode: cached.themeMode,
        displayMode: cached.displayMode,
        updatedAt: attemptedAt
      }
    }).then((response) => {
      const serverPreferences = normalizePreferences(response && response.preferences);
      const currentCache = readCachedPreferences();
      if (currentCache && currentCache.updatedAt === attemptedAt) {
        shared.state.preferences = serverPreferences.updatedAt ? serverPreferences : shared.state.preferences;
        writeCachedPreferences(shared.state.preferences, false);
        applyUiState();
      }
      shared.preferenceRetryAttempt = 0;
      return true;
    }).catch(() => {
      schedulePreferenceRetry();
      return false;
    }).finally(() => {
      shared.preferenceSaveInFlight = null;
      const latest = readCachedPreferences();
      if (latest && latest.dirty && latest.updatedAt !== attemptedAt) requestPreferenceSave();
    });
    return shared.preferenceSaveInFlight;
  }

export function schedulePreferenceRetry() {
    if (shared.preferenceRetryTimer || !shared.state.eligible) return;
    const delay = Math.min(30000, 1000 * (2 ** Math.min(5, shared.preferenceRetryAttempt++)));
    shared.preferenceRetryTimer = setTimeout(() => {
      shared.preferenceRetryTimer = null;
      if (navigator.onLine !== false) requestPreferenceSave();
      else schedulePreferenceRetry();
    }, delay);
  }

export function updatePreference(kind, value) {
    if (!shared.state.eligible) return false;
    if (kind === 'theme' && !shared.state.flags.preferences) return false;
    if (kind === 'display' && (!shared.state.flags.card_grid || (normalizeDisplayMode(value) === 'grid' && !gridIsSupportedHere()))) return false;
    const next = {
      ...shared.state.preferences,
      updatedAt: nextPreferenceTimestamp()
    };
    if (kind === 'theme') next.themeMode = normalizeThemeMode(value);
    if (kind === 'display') next.displayMode = normalizeDisplayMode(value);
    shared.state.preferences = next;
    writeCachedPreferences(next, true);
    applyUiState();
    if (kind === 'display' && shared.state.activeView === 'drive' && typeof window.scheduleDriveRender === 'function') {
      window.setTimeout(() => window.scheduleDriveRender(0, 0), 0);
    }
    requestPreferenceSave();
    return false;
  }

export function installControlHandlers() {
    document.querySelectorAll('button[data-ops-theme-mode]').forEach((button) => {
      if (button.dataset.opsBound === 'true') return;
      button.dataset.opsBound = 'true';
      button.addEventListener('click', () => updatePreference('theme', button.getAttribute('data-ops-theme-mode')));
    });
    document.querySelectorAll('button[data-ops-display-mode]').forEach((button) => {
      if (button.dataset.opsBound === 'true') return;
      button.dataset.opsBound = 'true';
      button.addEventListener('click', () => updatePreference('display', button.getAttribute('data-ops-display-mode')));
    });
  }

