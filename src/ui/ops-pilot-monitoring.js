import { HEALTH_ASSERTIONS, PERFORMANCE_KINDS, RELEASE, SENSITIVE_KEY_PATTERN, SENTRY_BUNDLE_URL, healthDedupe, shared } from './ops-pilot-state.js';
import { getEffectiveDisplayMode, getEffectiveTheme } from './ops-pilot-appearance.js';
import { scheduleLayoutHealthCheck } from './ops-pilot-layout.js';

export function browserFamily() {
    const ua = String(navigator.userAgent || '');
    if (/Edg\//.test(ua)) return 'edge';
    if (/CriOS\//.test(ua)) return 'chrome-ios';
    if (/Chrome\//.test(ua)) return 'chrome';
    if (/FxiOS\//.test(ua)) return 'firefox-ios';
    if (/Firefox\//.test(ua)) return 'firefox';
    if (/Safari\//.test(ua) && /Mobile\//.test(ua)) return 'safari-ios';
    if (/Safari\//.test(ua)) return 'safari';
    return 'other';
  }

export function viewportClass() {
    const width = Number(window.innerWidth || 0);
    if (width < 600) return 'phone';
    if (width < 1024) return 'tablet';
    if (width < 1440) return 'desktop';
    return 'wide';
  }

export function redactText(value) {
    return String(value == null ? '' : value)
      .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[photo-data]')
      .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
      .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[email]')
      .replace(/\bdylan_collyge\b/gi, '[user]')
      .replace(/\b(?:[A-Z]{1,5}[-_.])?\d{4,}[A-Z0-9._-]*\b/gi, '[code]')
      .replace(/([?&][^=\s]+)=([^&#\s]*)/g, '$1=[redacted]')
      .slice(0, 320);
  }

export function scrubValue(value, depth, key) {
    if (SENSITIVE_KEY_PATTERN.test(String(key || ''))) return '[redacted]';
    if (depth > 8) return '[truncated]';
    if (typeof value === 'string') return redactText(value);
    if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => scrubValue(item, depth + 1, ''));
    if (typeof value === 'object') {
      const output = {};
      Object.keys(value).slice(0, 40).forEach((childKey) => {
        output[childKey] = scrubValue(value[childKey], depth + 1, childKey);
      });
      return output;
    }
    return String(value);
  }

export function scrubSentryEvent(event) {
    if (!event || typeof event !== 'object') return event;
    delete event.user;
    delete event.request;
    delete event.breadcrumbs;
    if (event.message) event.message = redactText(event.message);
    if (event.transaction) event.transaction = redactText(event.transaction).replace(/\?.*$/, '');
    if (event.exception && Array.isArray(event.exception.values)) {
      event.exception.values.forEach((entry) => {
        if (entry && entry.value) entry.value = redactText(entry.value);
      });
    }
    event.extra = scrubValue(event.extra || {}, 0, 'extra');
    event.contexts = scrubValue(event.contexts || {}, 0, 'contexts');
    const tags = {
      release: RELEASE,
      browser_family: browserFamily(),
      viewport_class: viewportClass(),
      active_view: shared.state.activeView,
      theme: getEffectiveTheme(),
      theme_mode: shared.state.preferences.themeMode,
      display_mode: getEffectiveDisplayMode(),
      session_id: shared.state.sessionId
    };
    const scrubbedEvent = scrubValue(event, 0, '');
    scrubbedEvent.tags = tags;
    return scrubbedEvent;
  }

export function loadMonitoringBundle() {
    if (window.GncSentry && typeof window.GncSentry.init === 'function') return Promise.resolve(window.GncSentry);
    if (shared.monitoringLoadPromise) return shared.monitoringLoadPromise;
    shared.monitoringLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${SENTRY_BUNDLE_URL}?v=${encodeURIComponent(RELEASE)}`;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.dataset.opsSentryBundle = '10.70.0';
      script.addEventListener('load', () => resolve(window.GncSentry));
      script.addEventListener('error', () => reject(new Error('Monitoring bundle failed to load.')));
      document.head.appendChild(script);
    });
    return shared.monitoringLoadPromise;
  }

export function updateMonitoringTags() {
    const sentry = window.GncSentry;
    if (!shared.monitoringReady || !sentry || typeof sentry.setTags !== 'function') return;
    sentry.setTags({
      release: RELEASE,
      browser_family: browserFamily(),
      viewport_class: viewportClass(),
      active_view: shared.state.activeView,
      theme: getEffectiveTheme(),
      theme_mode: shared.state.preferences.themeMode,
      display_mode: getEffectiveDisplayMode(),
      session_id: shared.state.sessionId
    });
  }

export function initializeMonitoring(config) {
    if (shared.monitoringReady || !shared.state.monitoringEligible || !shared.state.flags.monitoring || !config || !config.dsn) return Promise.resolve(false);
    return loadMonitoringBundle().then((sentry) => {
      if (!sentry || typeof sentry.init !== 'function') return false;
      const defaultIntegrationsFilter = (integrations) => (integrations || []).filter((integration) => {
        const name = String(integration && integration.name || '');
        return !/Replay|Breadcrumbs|Feedback|UserAgent/i.test(name);
      });
      const integrations = [];
      if (typeof sentry.browserTracingIntegration === 'function') integrations.push(sentry.browserTracingIntegration());
      sentry.init({
        dsn: String(config.dsn || '').trim(),
        release: RELEASE,
        environment: 'production-pilot',
        enabled: true,
        sampleRate: 1,
        sendDefaultPii: false,
        tracesSampleRate: Math.max(0, Math.min(1, Number(config.tracesSampleRate || config.traces_sample_rate || 0.1))),
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        maxBreadcrumbs: 0,
        normalizeDepth: 3,
        tracePropagationTargets: [],
        integrations(defaultIntegrations) {
          return [...defaultIntegrationsFilter(defaultIntegrations), ...integrations];
        },
        beforeBreadcrumb() {
          return null;
        },
        beforeSend(event) {
          return scrubSentryEvent(event);
        },
        beforeSendTransaction(event) {
          return scrubSentryEvent(event);
        },
        beforeSendSpan(span) {
          return scrubValue(span, 0, 'span');
        },
        initialScope: {
          tags: {
            release: RELEASE,
            browser_family: browserFamily(),
            viewport_class: viewportClass(),
            active_view: shared.state.activeView,
            theme: getEffectiveTheme(),
            theme_mode: shared.state.preferences.themeMode,
            display_mode: getEffectiveDisplayMode(),
            session_id: shared.state.sessionId
          }
        }
      });
      if (typeof sentry.setUser === 'function') sentry.setUser(null);
      shared.monitoringReady = true;
      updateMonitoringTags();
      scheduleLayoutHealthCheck('monitoring-ready');
      return true;
    }).catch(() => false);
  }

export function captureFailure(kind, error) {
    const sentry = window.GncSentry;
    const safeKind = /upload/i.test(kind) ? 'upload' : /commit/i.test(kind) ? 'commit' : 'operation';
    if (typeof window.reportSemanticHealthEvent === 'function') {
      window.reportSemanticHealthEvent(
        `${safeKind}_failure`,
        safeKind === 'upload' ? 'photo_upload' : 'app_operation',
        `${safeKind.toUpperCase()}_FAILED`
      );
    }
    if (!shared.monitoringReady || !sentry) return;
    if (error instanceof Error && typeof sentry.captureException === 'function') {
      const sanitizedError = new Error(redactText(error.message || `${safeKind} failed`));
      sanitizedError.name = `${safeKind[0].toUpperCase()}${safeKind.slice(1)}Failure`;
      sentry.captureException(sanitizedError, { tags: { failure_kind: safeKind } });
    } else if (typeof sentry.captureMessage === 'function') {
      sentry.captureMessage(`${safeKind} failed`, { level: 'error', tags: { failure_kind: safeKind } });
    }
  }

export function observeToast(title, message, isAlert) {
    if (!shared.monitoringReady) return;
    const combined = `${String(title || '')} ${String(message || '')}`;
    if (!isAlert && !/fail|error|unable|could not/i.test(combined)) return;
    if (/upload|photo/i.test(combined)) captureFailure('upload');
    else if (/commit/i.test(combined)) captureFailure('commit');
  }

function buildPerformanceSpan(safeKind, safePayload, duration) {
    const operations = { viewSwitches:'navigation.route', chunks:'ui.chunk', longTasks:'ui.long-task', staleSkips:'ui.stale-work' };
    return {
        name: `ops.${safeKind}`,
        op: operations[safeKind] || 'ui.render',
        attributes: {
          duration_ms: Math.round(duration * 100) / 100,
          active_view: shared.state.activeView,
          sample_index: safeKind === 'longTasks' ? shared.longTaskCount : undefined,
          metric_type: typeof safePayload.metricType === 'string' ? safePayload.metricType.slice(0, 24) : undefined,
          cancelled: typeof safePayload.cancelled === 'boolean' ? safePayload.cancelled : undefined
        }
      };
}

export function recordPerformance(kind, payload) {
    const sentry = window.GncSentry;
    if (!shared.monitoringReady || !sentry) return;
    const safeKind = String(kind || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'performance';
    if (!PERFORMANCE_KINDS.has(safeKind)) return;
    const safePayload = scrubValue(payload && typeof payload === 'object' ? payload : {}, 0, 'perf');
    const duration = Number(safePayload.duration || safePayload.durationMs || 0);
    if (safeKind === 'longTasks' && duration >= 100) shared.longTaskCount += 1;
    if (typeof sentry.startSpan === 'function') {
      const span = buildPerformanceSpan(safeKind, safePayload, duration);
      sentry.startSpan(span, function () {});
    }
  }

export function captureHealth(assertion, passed, metrics = {}) {
    const sentry = window.GncSentry;
    const safeAssertion = String(assertion || '').trim().toLowerCase();
    if (!shared.monitoringReady || !sentry || !HEALTH_ASSERTIONS.has(safeAssertion)) return false;
    if (passed && Math.random() > 0.1) return false;
    const dedupeKey = `${RELEASE}|${shared.state.activeView}|${getEffectiveTheme()}|${viewportClass()}|${safeAssertion}|${passed ? 'pass' : 'fail'}`;
    const now = Date.now();
    if (now - Number(healthDedupe.get(dedupeKey) || 0) < 300000) return false;
    healthDedupe.set(dedupeKey, now);
    while (healthDedupe.size > 80) healthDedupe.delete(healthDedupe.keys().next().value);
    const safeMetrics = {};
    Object.entries(metrics && typeof metrics === 'object' ? metrics : {}).slice(0, 12).forEach(([key, value]) => {
      const safeKey = String(key || '').replace(/[^a-z0-9_]/gi, '').slice(0, 30);
      if (!safeKey || SENSITIVE_KEY_PATTERN.test(safeKey)) return;
      if (typeof value === 'boolean' || Number.isFinite(Number(value))) safeMetrics[safeKey] = typeof value === 'boolean' ? value : Math.round(Number(value) * 100) / 100;
    });
    if (typeof sentry.captureMessage === 'function') {
      sentry.captureMessage(`layout.${safeAssertion}.${passed ? 'pass' : 'fail'}`, {
        level: passed ? 'info' : 'warning',
        tags: { health_assertion: safeAssertion, health_status: passed ? 'pass' : 'fail' },
        extra: safeMetrics
      });
    }
    return true;
  }

