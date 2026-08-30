import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FORBIDDEN_PATHS = [
  /^supabase\//i,
  /(^|\/)Code\.gs$/i,
  /(^|\/)(?:\.env(?:\.|$)|credentials?|secrets?)(?:\/|$)/i,
  /(^|\/)node_modules\//i,
  /(^|\/)dist\//i,
  /^assets\/vendor\//i,
  /^\.github\/workflows\/codex-ops(?:-|\.)/i,
  /^\.github\/workflows\/codex-mobile-path-policy\.ya?ml$/i,
  /^\.github\/workflows\/(?:performance-monitor|pages-static|production-auth-health)\.ya?ml$/i,
  /^\.github\/codex-ops-ruleset\.json$/i,
  /^scripts\/configure-codex-ops-ruleset\.mjs$/i,
  /^scripts\/codex-ops-runner-client\.mjs$/i,
  /^scripts\/validate-codex-mobile-patch\.mjs$/i,
  /^scripts\/probe-production-auth-health\.mjs$/i,
  /^scripts\/wait-for-live-release\.mjs$/i,
];

export const ALLOWED_PATHS = [
  /^index\.html$/i,
  /^sw\.js$/i,
  /^manifest\.json$/i,
  /^OneSignalSDKWorker\.js$/i,
  /^assets\/(?!vendor\/).+/i,
  /^tests\/.+/i,
  /^v2\/.+/i,
  /^scripts\/.+\.(?:mjs|js|ts|json|sql)$/i,
  /^\.github\/workflows\/.+\.ya?ml$/i,
  /^(?:package|package-lock)\.json$/i,
  /^(?:tsconfig|vite|playwright|lighthouserc).+\.(?:json|js|mjs|ts)$/i,
];

export const UNSAFE_WORKFLOW_PATTERNS = [
  /\bpull_request_target\s*:/i,
  /\bself-hosted\b/i,
  /\bwrite-all\b/i,
  /\bopenai\/codex-action@(?:main|master|v\d+)\b/i,
  /\$\{\{\s*secrets\./i,
  /\b(?:contents|actions|checks|deployments|id-token|packages|pages|pull-requests|security-events|statuses)\s*:\s*write\b/i,
  /\bworkflow_run\s*:/i,
];

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function validateChangedFiles(files, root = process.cwd()) {
  const errors = [];
  const normalized = [
    ...new Set(
      files
        .map((file) =>
          String(file || "")
            .replaceAll("\\", "/")
            .replace(/^\.\//, ""),
        )
        .filter(Boolean),
    ),
  ];
  if (!normalized.length) errors.push("PATCH_EMPTY");
  if (normalized.length > 200) errors.push("PATCH_FILE_LIMIT");
  for (const file of normalized) {
    if (file.includes("..") || path.isAbsolute(file)) {
      errors.push(`PATH_INVALID:${file}`);
      continue;
    }
    if (FORBIDDEN_PATHS.some((pattern) => pattern.test(file)))
      errors.push(`PATH_FORBIDDEN:${file}`);
    else if (!ALLOWED_PATHS.some((pattern) => pattern.test(file)))
      errors.push(`PATH_NOT_ALLOWED:${file}`);
    const absolute = path.resolve(root, file);
    if (fs.existsSync(absolute) && fs.lstatSync(absolute).isSymbolicLink())
      errors.push(`SYMLINK_FORBIDDEN:${file}`);
    if (
      /^\.github\/workflows\/.+\.ya?ml$/i.test(file) &&
      fs.existsSync(absolute)
    ) {
      const source = fs.readFileSync(absolute, "utf8");
      for (const pattern of UNSAFE_WORKFLOW_PATTERNS) {
        if (pattern.test(source))
          errors.push(`WORKFLOW_PRIVILEGE_FORBIDDEN:${file}`);
      }
    }
  }
  return { ok: errors.length === 0, files: normalized, errors };
}

export function changedFilesFromGit({
  worktree = false,
  base = "",
  head = "HEAD",
} = {}) {
  const args = worktree
    ? ["diff", "--name-only", "--diff-filter=ACMRTUXB", "HEAD", "--"]
    : [
        "diff",
        "--name-only",
        "--diff-filter=ACMRTUXB",
        `${base || "origin/main"}...${head}`,
        "--",
      ];
  const tracked = git(args).split(/\r?\n/).filter(Boolean);
  if (worktree) {
    const untracked = git(["ls-files", "--others", "--exclude-standard"])
      .split(/\r?\n/)
      .filter(Boolean);
    return [...new Set([...tracked, ...untracked])];
  }
  return tracked;
}

function runCli() {
  const args = new Set(process.argv.slice(2));
  const baseArg = process.argv.find((value) => value.startsWith("--base="));
  const headArg = process.argv.find((value) => value.startsWith("--head="));
  const result = validateChangedFiles(
    changedFilesFromGit({
      worktree: args.has("--worktree"),
      base: baseArg?.slice("--base=".length) || "",
      head: headArg?.slice("--head=".length) || "HEAD",
    }),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  runCli();
