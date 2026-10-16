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
