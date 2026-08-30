import fs from "node:fs";

function fail(code) {
  process.stderr.write(
    `${String(code || "CODEX_OPS_RUNNER_CLIENT_FAILED")
      .replace(/[^A-Z0-9_:-]+/gi, "_")
      .slice(0, 160)}\n`,
  );
  process.exit(1);
}

async function oidcToken() {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  const audience = process.env.CODEX_OPS_OIDC_AUDIENCE || "gnc-codex-ops-v1";
  if (!requestUrl || !requestToken) fail("CODEX_OPS_OIDC_ENV_MISSING");
  const url = new URL(requestUrl);
  url.searchParams.set("audience", audience);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${requestToken}` },
  });
  if (!response.ok) fail(`CODEX_OPS_OIDC_FETCH_${response.status}`);
  const payload = await response.json();
  if (!payload?.value) fail("CODEX_OPS_OIDC_TOKEN_MISSING");
  return payload.value;
}

async function callRunner(body) {
  const base = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  if (!base) fail("CODEX_OPS_SUPABASE_URL_MISSING");
  const response = await fetch(`${base}/functions/v1/codex-ops-runner`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await oidcToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    fail(payload?.error || `CODEX_OPS_RUNNER_${response.status}`);
  return payload;
}

const command = process.argv[2];
if (command === "context") {
  const payload = await callRunner({
    operation: "context",
    taskId: process.env.CODEX_OPS_TASK_ID,
    revision: Number(process.env.CODEX_OPS_REVISION),
    dispatchAction: process.env.CODEX_OPS_ACTION || "diagnose",
  });
  const output = process.env.CODEX_OPS_OUTPUT_FILE;
  if (!output) fail("CODEX_OPS_OUTPUT_FILE_MISSING");
  fs.writeFileSync(output, JSON.stringify(payload), { mode: 0o600 });
} else if (command === "result") {
  const input = process.env.CODEX_OPS_RESULT_FILE;
  if (!input) fail("CODEX_OPS_RESULT_FILE_MISSING");
  const result = JSON.parse(fs.readFileSync(input, "utf8"));
  await callRunner({
    operation: "result",
    taskId: process.env.CODEX_OPS_TASK_ID,
    revision: Number(process.env.CODEX_OPS_REVISION),
    stage: process.env.CODEX_OPS_STAGE,
    result,
  });
} else if (command === "cleanup") {
  const payload = await callRunner({ operation: "cleanup" });
  process.stdout.write(
    `${JSON.stringify({ deleted: Number(payload?.deleted || 0) })}\n`,
  );
} else if (command === "rollback-merge") {
  const payload = await callRunner({
    operation: "rollback-merge",
    taskId: process.env.CODEX_OPS_TASK_ID,
    revision: Number(process.env.CODEX_OPS_REVISION),
    pullRequestNumber: Number(process.env.CODEX_OPS_ROLLBACK_PR),
    headSha: process.env.CODEX_OPS_ROLLBACK_SHA,
  });
  if (process.env.CODEX_OPS_OUTPUT_FILE) {
    fs.writeFileSync(
      process.env.CODEX_OPS_OUTPUT_FILE,
      JSON.stringify(payload),
      { mode: 0o600 },
    );
  }
} else {
  fail("CODEX_OPS_RUNNER_COMMAND_INVALID");
}
