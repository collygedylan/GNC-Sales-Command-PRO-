const owner = process.env.CODEX_OPS_GITHUB_OWNER || "collygedylan";
const repo = process.env.CODEX_OPS_GITHUB_REPO || "GNC-Sales-Command-PRO-";
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
const apply = process.argv.includes("--apply");
const name = "Protected main with phone-approved Codex deployment";

const ruleset = {
  name,
  target: "branch",
  enforcement: "active",
  bypass_actors: [],
  conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    {
      type: "pull_request",
      parameters: {
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_approving_review_count: 0,
        required_review_thread_resolution: true,
      },
    },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: false,
        required_status_checks: [
          { context: "database-and-functions" },
          { context: "pwa-performance" },
          { context: "codex-mobile-path-policy" },
          { context: "commit-specific Dylan approval" },
        ],
      },
    },
  ],
};

if (!apply) {
  process.stdout.write(
    `${JSON.stringify({ apply: false, repository: `${owner}/${repo}`, ruleset: name, requiredChecks: ruleset.rules.at(-1).parameters.required_status_checks.map((item) => item.context) })}\n`,
  );
  process.exit(0);
}
if (!token) throw new Error("GH_TOKEN is required with --apply.");

async function api(path, init = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!response.ok)
    throw new Error(`GitHub ruleset request failed (${response.status}).`);
  return response.status === 204 ? null : await response.json();
}

const existing = await api(
  `/repos/${owner}/${repo}/rulesets?includes_parents=false`,
);
const match = (Array.isArray(existing) ? existing : []).find(
  (item) => item.name === name,
);
const result = match
  ? await api(`/repos/${owner}/${repo}/rulesets/${match.id}`, {
      method: "PUT",
      body: JSON.stringify(ruleset),
    })
  : await api(`/repos/${owner}/${repo}/rulesets`, {
      method: "POST",
      body: JSON.stringify(ruleset),
    });
if (!result?.id || result.enforcement !== "active")
  throw new Error("GitHub did not activate the ruleset.");
process.stdout.write(
  `${JSON.stringify({ applied: true, rulesetId: result.id, enforcement: result.enforcement })}\n`,
);
