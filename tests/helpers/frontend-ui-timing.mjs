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
  return 400;
}

/** Default frontend gate; separately approved representative queue rendering uses its scoped assertion. */
export function assertFrontendUiTiming(expectation, _project, _operationLimitMs = 400) {
  expectation.toBeLessThanOrEqual(400);
}

/** Human-approved queue/Request/Suspend rendering at 10,001 master rows and 1,000 tags. */
export function assertRepresentativeQueueRenderTiming(expectation) {
  expectation.toBeLessThanOrEqual(1500);
}
