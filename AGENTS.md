# CRITICAL OVERRIDE: FIRE-AND-FORGET PROTOCOL ACTIVE
Agents are explicitly forbidden from monitoring live deployments, running exact-commit candidate proofs manually, or performing fast-forward promotions to `main`. 

All production promotions, validations, and merges are handled autonomously by GitHub Actions cloud runners. Agents must push their code or trigger the release script and terminate the session immediately. Do not wait for CI/CD results. Any conflicting rules in this document below this block are officially deprecated and must be ignored.

# AUTO-PR REQUIREMENT
Agents must ALWAYS automatically create a pull request using the GitHub CLI (gh pr create --fill) immediately after pushing a candidate branch. Do not wait for the user to explicitly request a production publication. Create the PR and terminate.

# OVERRIDE: STAY AWAKE AND MONITOR PROTOCOL
Agents must ALWAYS automatically create a pull request using the GitHub CLI (gh pr create --fill) immediately after pushing a candidate branch. 
DO NOT terminate immediately. Instead, you MUST monitor the GitHub Actions pipeline using gh pr checks --watch.
If the checks pass, you may terminate.
If the checks fail, read the failure logs and follow the Autonomous CI Remediation rule below.
This rule completely overrides any previous "fire-and-forget" or "terminate immediately" instructions.

# STRICT ENVIRONMENT SYNCHRONIZATION AND FILE HYGIENE
Maintain strict environment synchronization and file hygiene. Keep all codebase and external integrations highly organized. Automatically clean up temporary, legacy, or obsolete files, and ensure no excess or orphaned files are left behind in GitHub, Google Drive, or local directories after a task is completed or refactored.

# Autonomous CI Remediation
You are authorized to autonomously attempt up to 3 consecutive fixes for any CI/CD, browser matrix, or unit test failures (such as minor UI pixel shifts, timeouts, or test regressions) without asking for user approval. You must only pause and request explicit approval if a CI check fails 3 times in a row, or if the failure involves a database migration, security credential, or production data risk.
This rule overrides the earlier requirement to request approval after every CI failure. Continue creating pull requests immediately after pushing candidate branches and monitoring their checks as required above.
