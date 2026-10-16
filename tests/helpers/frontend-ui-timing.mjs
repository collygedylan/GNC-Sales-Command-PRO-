/** Detect Playwright iPhone device emulation, never a project name alone. */
export function isIPhoneSimulatorProject(project = {}) {
  const use = project.use || {};
  const iphoneAgent = /\biPhone\b/.test(String(use.userAgent || ''));
  const namedPhoneViewport = /(?:^|[-_])iphone(?:$|[-_])/i.test(String(project.name || ''))
    && Number(use.viewport?.width) > 0 && Number(use.viewport?.width) <= 480
    && Number(use.viewport?.height) > Number(use.viewport?.width);
  return use.isMobile === true && use.hasTouch === true && (iphoneAgent || namedPhoneViewport);
}

export function frontendUiTimingLimitMs(project) {
  return isIPhoneSimulatorProject(project) ? 400 : 100;
}

/** Human-approved frontend-only gates: iPhone simulator <=400ms; others <100ms. */
export function assertFrontendUiTiming(expectation, project, desktopLimitMs = 100) {
  if (isIPhoneSimulatorProject(project)) expectation.toBeLessThanOrEqual(400);
  else expectation.toBeLessThan(Math.min(100, desktopLimitMs));
}
