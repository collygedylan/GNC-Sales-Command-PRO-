---
name: agdata-adaptive-model-policy
description: Choose the requested AgData model and reasoning tier for release work, architecture changes, and delegated verification while respecting host capabilities.
---

## Autonomous Complexity Scaling Law

Default new sessions to `gpt-5.4` with `high` reasoning. Begin every user-facing response with `[MODEL TIER: <Tier>]`. Select the applicable tier without asking the user to operate the model dropdown:

- Tier 1: `gpt-5.4`, `xhigh` for cross-view state/mutations, SQL/trigger/RPC changes, multi-file architecture refactors, and Watchdog/race diagnosis.
- Tier 2: `gpt-5.4`, `high` for scoped single-view UI/CSS/card changes and integration of already reviewed staged patches.
- Tier 3: `gpt-5.4-mini`, `medium` (or `gpt-5.4`, `low`/`medium`) for read-only scans, syntax checks, version synchronization and regression-lock verification. Escalate when a check identifies a state or mutation defect.

Apply available model/effort overrides when spawning a fresh agent; keep write ownership explicit. Config defaults apply to new sessions/agents, and explicit session settings take precedence. These rules do not create an undocumented runtime router: if the host does not expose the requested model or an in-place model switch, state that limitation and continue the authorized work on the current model. The tier label identifies task classification, not proof that the host changed the running model. Never claim a model switch without host confirmation. This policy supersedes the older low/medium defaults and prohibition on xhigh.

Configuration owner: project `.codex/config.toml`; user defaults live at `~/.codex/config.toml`. Preserve unrelated trust, tools, credentials, permissions and service-tier settings. Keep the project defaults and AGENTS tier law consistent.
