export function getLoafTimingIntervals(frame = {}) {
  const startTime = frame.startTime;
  const duration = frame.duration;
  if (!Number.isFinite(startTime) || !Number.isFinite(duration) || duration < 0) {
    return { renderCycle: null, styleAndLayout: null };
  }
  const frameEnd = startTime + duration;
  const renderStart = frame.renderStart;
  const styleAndLayoutStart = frame.styleAndLayoutStart;
  const interval = (start) => Number.isFinite(start) && start >= startTime && start <= frameEnd
    ? [start, frameEnd]
    : null;
  return { renderCycle: interval(renderStart), styleAndLayout: interval(styleAndLayoutStart) };
}

export function durationOutsideIntervals(start, end, intervals = []) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const clipped = intervals.map((interval) => [
    Math.max(start, interval?.[0]),
    Math.min(end, interval?.[1])
  ]).filter(([left, right]) => Number.isFinite(left) && Number.isFinite(right) && right > left)
    .sort((left, right) => left[0] - right[0]);
  let covered = 0;
  let activeStart = null;
  let activeEnd = null;
  for (const [left, right] of clipped) {
    if (activeEnd === null) {
      activeStart = left;
      activeEnd = right;
    } else if (left <= activeEnd) {
      activeEnd = Math.max(activeEnd, right);
    } else {
      covered += activeEnd - activeStart;
      activeStart = left;
      activeEnd = right;
    }
  }
  if (activeEnd !== null) covered += activeEnd - activeStart;
  return Math.max(0, end - start - covered);
}
