function base64Url(input: string | Uint8Array) {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function pemBytes(pem: string) {
  const value = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function appJwt() {
  const appId = String(Deno.env.get("CODEX_OPS_GITHUB_APP_ID") || "").trim();
  const privateKey = String(
    Deno.env.get("CODEX_OPS_GITHUB_APP_PRIVATE_KEY") || "",
  ).trim();
  if (!appId || !privateKey)
    throw new Error("CODEX_OPS_GITHUB_APP_NOT_CONFIGURED");
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ iat: now - 30, exp: now + 540, iss: appId }),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

export function repoIdentity() {
  return {
    owner: String(
      Deno.env.get("CODEX_OPS_GITHUB_OWNER") || "collygedylan",
    ).trim(),
    repo: String(
      Deno.env.get("CODEX_OPS_GITHUB_REPO") || "GNC-Sales-Command-PRO-",
    ).trim(),
  };
}

export async function installationToken() {
  const installationId = String(
    Deno.env.get("CODEX_OPS_GITHUB_INSTALLATION_ID") || "",
  ).trim();
  if (!installationId) throw new Error("CODEX_OPS_GITHUB_APP_NOT_CONFIGURED");
  const response = await fetch(
    `https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await appJwt()}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "gnc-codex-ops-v1",
      },
    },
  );
  if (!response.ok) throw new Error("CODEX_OPS_GITHUB_APP_TOKEN_FAILED");
  const payload = await response.json();
  if (!payload?.token) throw new Error("CODEX_OPS_GITHUB_APP_TOKEN_FAILED");
  return String(payload.token);
}

export async function githubApi(
  path: string,
  init: RequestInit = {},
  token = "",
) {
  const authToken = token || (await installationToken());
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${authToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "gnc-codex-ops-v1",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`CODEX_OPS_GITHUB_${response.status}`);
  return response.status === 204 ? null : await response.json();
}

export async function dispatchCodexWorkflow(
  taskId: string,
  revision: number,
  action: string,
) {
  const { owner, repo } = repoIdentity();
  await githubApi(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/codex-ops.yml/dispatches`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: "main",
        inputs: { task_id: taskId, revision: String(revision), action },
      }),
    },
  );
}

export async function approveCheckAndMerge(
  pullRequestNumber: number,
  expectedSha: string,
) {
  const { owner, repo } = repoIdentity();
  const token = await installationToken();
  const pull = await githubApi(
    `/repos/${owner}/${repo}/pulls/${pullRequestNumber}`,
    {},
    token,
  );
  const actualSha = String(pull?.head?.sha || "").toLowerCase();
  if (actualSha !== expectedSha.toLowerCase())
    throw new Error("CODEX_OPS_HEAD_CHANGED");
  if (
    pull?.merged === true &&
    /^[0-9a-f]{40}$/.test(String(pull?.merge_commit_sha || "").toLowerCase())
  ) {
    return String(pull.merge_commit_sha).toLowerCase();
  }
  const checks = await githubApi(
    `/repos/${owner}/${repo}/commits/${actualSha}/check-runs?per_page=100`,
    {},
    token,
  );
  const required = String(
    Deno.env.get("CODEX_OPS_REQUIRED_CHECKS") ||
      "database-and-functions,pwa-performance,codex-mobile-path-policy",
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const successful = new Set(
    (checks?.check_runs || [])
      .filter(
        (run: any) =>
          run.status === "completed" && run.conclusion === "success",
      )
      .map((run: any) => String(run.name)),
  );
  if (required.some((name) => !successful.has(name)))
    throw new Error("CODEX_OPS_CHECKS_INCOMPLETE");
  await githubApi(
    `/repos/${owner}/${repo}/check-runs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "commit-specific Dylan approval",
        head_sha: actualSha,
        status: "completed",
        conclusion: "success",
        output: {
          title: "Phone approval verified",
          summary:
            "The authenticated approval matched this exact task revision and commit SHA.",
        },
      }),
    },
    token,
  );
  const merge = await githubApi(
    `/repos/${owner}/${repo}/pulls/${pullRequestNumber}/merge`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: actualSha, merge_method: "squash" }),
    },
    token,
  );
  if (!merge?.merged) throw new Error("CODEX_OPS_MERGE_FAILED");
  return String(merge.sha || "").toLowerCase();
}
