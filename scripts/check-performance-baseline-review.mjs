import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseBenchmarkManifest } from '../services/performanceBaseline.ts';
import { run } from './tooling-process.mjs';

export function baselineChanged(previous, current) {
  parseBenchmarkManifest(current);
  return previous !== null && JSON.stringify(previous) !== JSON.stringify(current);
}

// The owner explicitly authorized this exact temporary profile for PR #349 on
// 2026-10-09 and its removal in roadmap Prompt 7. No baseline, fixture, sample,
// or other budget change is covered by that authorization.
export function isApprovedRoadmapTimingChange(previous, current, pullRequestNumber) {
  if (!previous) return false;
  const before = parseBenchmarkManifest(previous), after = parseBenchmarkManifest(current);
  const withoutAllowance = value => {
    const copy = { ...value };
    delete copy.temporaryTimingAllowance;
    return copy;
  };
  if (JSON.stringify(withoutAllowance(previous)) !== JSON.stringify(withoutAllowance(current))) return false;
  return (!before.temporaryTimingAllowance && !!after.temporaryTimingAllowance && pullRequestNumber === 349)
    || (!!before.temporaryTimingAllowance && !after.temporaryTimingAllowance);
}

export function hasCurrentHumanApproval(reviews, head) {
  const latest = new Map();
  for (const review of reviews) {
    if (review.user?.login && review.state !== 'COMMENTED') latest.set(review.user.login, review);
  }
  return [...latest.values()].some(review => review.state === 'APPROVED' && review.commit_id === head
    && review.user.type === 'User' && ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(review.author_association));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const current = JSON.parse(readFileSync('performance/baseline.json', 'utf8'));
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const base = event.pull_request?.base.sha || run('git', ['rev-parse', 'origin/main'], { capture: true }).trim();
  const file = 'performance/baseline.json';
  const exists = run('git', ['ls-tree', '--name-only', base, '--', file], { capture: true }).trim() === file;
  const previous = exists ? JSON.parse(run('git', ['show', `${base}:${file}`], { capture: true })) : null;
  if (baselineChanged(previous, current)
      && !isApprovedRoadmapTimingChange(previous, current, event.pull_request?.number)) {
    const number = event.pull_request?.number, head = event.pull_request?.head.sha;
    const repository = process.env.GITHUB_REPOSITORY;
    if (!number || !head || !/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !process.env.GITHUB_TOKEN) throw new Error('PERFORMANCE_BASELINE_REVIEW_REQUIRED');
    const reviews = [];
    for (let page = 1; page <= 10; page++) {
      const response = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}/repos/${repository}/pulls/${number}/reviews?per_page=100&page=${page}`, {
        headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error('PERFORMANCE_BASELINE_REVIEW_LOOKUP_FAILED');
      const batch = await response.json();
      if (!Array.isArray(batch)) throw new Error('PERFORMANCE_BASELINE_REVIEW_RESPONSE_INVALID');
      reviews.push(...batch);
      if (batch.length < 100) break;
      if (page === 10) throw new Error('PERFORMANCE_BASELINE_REVIEW_PAGINATION_LIMIT');
    }
    if (!hasCurrentHumanApproval(reviews, head)) throw new Error('PERFORMANCE_BASELINE_REVIEW_REQUIRED: a human collaborator must approve the current commit before this baseline update can pass');
  }
  console.log('Performance baseline is unchanged, newly established, or explicitly reviewed.');
}
