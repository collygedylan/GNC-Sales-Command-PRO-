// One task keeps lint, project checks and tests inside lint-staged's protected
// staged snapshot. Never append filenames to tsc or run checks after restoration.
export default () => ['node scripts/precommit.mjs --staged'];
