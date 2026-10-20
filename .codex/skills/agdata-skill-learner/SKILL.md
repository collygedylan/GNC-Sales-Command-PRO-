---
name: agdata-skill-learner
description: Keep AgData domain skills and explicit fixture-read contracts synchronized when features, buttons, tables or RPCs are introduced or changed.
---

# Maintain skills alongside features

When adding or changing a feature, button, table or RPC:

1. Trace the actual ERP → Supabase → UI flow, including row identities, protected live fields, account permissions and owning domain skills, before coding.
2. Load only the affected domain skill bodies and any genuinely required cross-cutting guard. Do not expand every skill for unrelated work.
3. Register each new startup/background read in the shared Playwright fixture allowlist with its exact route, method, action/RPC, accepted parameters and response shape. Add a focused unknown-route rejection case; never introduce a wildcard success stub.
4. Update the corresponding `.codex/skills/<skill-name>/SKILL.md` in the same commit with verified changed rules and useful source pointers. Preserve YAML name/description and precise activation boundaries.
5. Validate the skill manifests and affected contracts together with the implementation's selected checks. Record unresolved behavior honestly rather than teaching an unverified assumption as fact.

This is repository maintenance, not model training or automatic Gemini account synchronization. Improve skills from concrete feature changes or demonstrated failures; avoid duplicate global rules, speculative policies and unrelated cleanup. Existing user scope and authorization remain controlling.
