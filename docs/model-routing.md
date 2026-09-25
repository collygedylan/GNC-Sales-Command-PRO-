# GNC model routing

Use the least expensive available model and reasoning effort suited to the specific work. The owner remains responsible for the result and all release checks. Model routing never changes permissions, review requirements, or test coverage.

## Defaults and escalation

The project `.codex/config.toml` selects **GPT-6 Luna / low** for new sessions and delegated work by default. Standard speed is inherited; routine work must not opt into Fast mode. The owner chooses explicit model and effort values for each useful delegated task:

| Work | Model and effort |
| --- | --- |
| Clear, bounded repairs, mechanical transformations, short summaries, or mechanical review | `gpt-6-luna`, low |
| Targeted exploration, log triage, routine isolated implementation | `gpt-5.6-terra`, medium |
| New cross-module behavior, related client/server changes, database migrations, or significant correctness review | `gpt-6-sol`, medium or high |
| Ambiguous cross-module failures, difficult concurrency, authorization/data-integrity design, or an unresolved diagnosis after a verified attempt | `gpt-6-astra`, high |

Start at the appropriate tier; do not first attempt a risky migration with a model chosen for mechanical edits. Increase effort or use Astra when concrete complexity warrants it. Max/Ultra are not routine defaults. Astra Max or Ultra is allowed without a separate permission request only for a bounded, already-authorized subtask involving difficult cross-module, concurrency, authorization, or data-integrity work after high effort is demonstrably insufficient; state the reason and return to the normal tier afterward. Explain an escalation in one sentence; no repeated permission request is needed for model selection within the authorized task. If a tier is unavailable, report that limitation rather than silently using a more expensive tier.

## Avoid duplicating the work

- Handle tiny tasks directly. Do not spawn an agent solely to claim model routing or to monitor a test run.
- For useful delegation, give a concise task, non-overlapping file ownership, the bounded diff or contract under review, relevant test evidence, and the expected output. Do not fork the entire task history into a differently configured worker.
- The owner reviews the result and required evidence; it does not repeat the worker's exploration. Keep the existing bounded independent review for releases.
- Run tests and CI monitoring with deterministic tools. Models inspect completion or actionable failures, not every polling interval.

## Supported behavior and limits

This is automatic selection **by the owner for delegated work**, plus project defaults. It is not a native task-complexity switch for the main conversation. The model running an existing response is not changed by editing these files. Explicit app/session selections can override the project defaults, and project settings must be loaded from the trusted repository/worktree. Tasks started in the old Google Drive reference folder may retain their original session settings even after tools change working directories; report the actual model setting rather than claiming a switch occurred. If GPT-6 Luna is unavailable, use GPT-5.6 Luna / low and record the fallback.

Official references: [model selection](https://learn.chatgpt.com/docs/models), [subagent models and effort](https://learn.chatgpt.com/docs/agent-configuration/subagents), and [configuration](https://learn.chatgpt.com/docs/config-file/config-reference).
