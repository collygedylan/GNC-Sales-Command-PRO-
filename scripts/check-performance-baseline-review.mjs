import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseBenchmarkManifest } from '../services/performanceBaseline.ts';
import { run } from './tooling-process.mjs';

export function baselineChanged(previous, current) {
  parseBenchmarkManifest(current);
  return previous !== null && JSON.stringify(previous) !== JSON.stringify(current);
}

// The Oct 9 owner instruction allowed PR #349 to add the initial profile only.
// On Oct 10, the owner authorized temporary timing relaxation for the three-phase
// execution; PR #357 records that instruction as the exact 100-to-200 ms browser
// floor change. Prompt 7 removes the temporary profile. No baseline, fixture,
// sample, or other budget change is covered by these exceptions.
export function isApprovedRoadmapTimingChange(previous, current, pullRequestNumber) {
  if (!previous) return false;
  const before = parseBenchmarkManifest(previous), after = parseBenchmarkManifest(current);
  const withoutAllowance = value => {
    const copy = { ...value };
    delete copy.temporaryTimingAllowance;
    return copy;
  };
  if (JSON.stringify(withoutAllowance(previous)) !== JSON.stringify(withoutAllowance(current))) return false;
  const allowanceKey = allowance => JSON.stringify(allowance);
  const initialProfile = { multiplier: 2, minimumBrowserAllowanceMs: 100, restoreAtPrompt: 7 };
  const currentProfile = { multiplier: 2, minimumBrowserAllowanceMs: 200, restoreAtPrompt: 7 };
  return (!before.temporaryTimingAllowance && allowanceKey(after.temporaryTimingAllowance) === allowanceKey(initialProfile) && pullRequestNumber === 349)
    || (allowanceKey(before.temporaryTimingAllowance) === allowanceKey(initialProfile)
      && allowanceKey(after.temporaryTimingAllowance) === allowanceKey(currentProfile) && pullRequestNumber === 357)
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
