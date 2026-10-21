/** The panel and signed email use this same bounded incident representation. */
export function buildRuntimeWatchdogFixBrief(rows: Record<string, unknown>[], version = "AgData v2.3.23", commit = "see deployed release metadata"): string {
  return [
    "# AgData Runtime Watchdog Fix Brief", "",
    `- Active App Version: ${version}`, `- Commit: ${commit}`, `- Open Incidents: ${rows.length}`,
    ...rows.map(row => `  - ${row.username} | ${row.normalized_role} | ${row.view_id}${row.sub_module ? ` / ${row.sub_module}` : ""} | ${row.duration_ms}ms | ${row.event_type}: ${row.error_message || "No error text"} | revisions=${JSON.stringify(row.dataset_revisions_snapshot || {})} | ${row.cluster_id} | .codex/skills/${row.owning_skill}/SKILL.md | ${JSON.stringify(row.suspected_functions || [])}`),
    "", "Focused verification: node --test tests/runtime-watchdog.test.mjs tests/role-access-parity.test.mjs tests/release-app-lifecycle.test.mjs tests/live-sync-coordinator.test.mjs tests/agdata-governance.test.mjs tests/agdata-architecture.test.mjs",
  ].join("\n");
}
