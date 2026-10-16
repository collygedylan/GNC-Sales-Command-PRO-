export function reclassModalPaintLimitMs(projectName, platform, deviceScaleFactor) {
  // Human-approved allowance for Windows WebKit's dense iPhone emulation.
  // Same-build control measured 129ms at DPR1 versus 438ms at DPR3, with
  // comparable 25–30ms synchronous app work. Native/mobile latency is unproven.
  // This does not relax optimistic quantity rendering or database limits.
  return projectName === 'cache-iphone' && platform === 'win32' && deviceScaleFactor === 3 ? 400 : 150;
}

export function scheduleReclassPaintProbeCheck(probe, requestFrame) {
  if (!probe || probe.result || probe.rafScheduled) return false;
  probe.rafScheduled = true;
  requestFrame(() => requestFrame(() => {
    probe.rafScheduled = false;
    if (probe.result) return;
    probe.finishAfterPaint();
  }));
  return true;
}
