import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';

export const FUNCTION_SERVER_LOG_TAIL_BYTES = 64 * 1024;

const classifications = Object.freeze([
  ['registry_rate_limited', /\b(?:toomanyrequests|too many requests|rate exceeded|rate limit exceeded|429\s+too many requests)\b/i],
  ['module_download_failed', /\b(?:failed|unable|error|could not)\b.{0,100}\b(?:download|pull|fetch)\b|\b(?:download|pull|fetch)\b.{0,100}\b(?:failed|unable|error)\b/i],
  ['runtime_bootstrap_failed', /\b(?:bootstrap failed|failed to bootstrap|failed to initialize|failed to start edge runtime|runtime startup failed)\b/i],
  ['cpu_hard_limit', /\bcpu\b.{0,100}\bhard\b.{0,60}\blimit\b|\bhard\b.{0,60}\bcpu\b.{0,100}\blimit\b/i],
  ['cpu_soft_limit', /\bcpu\b.{0,100}\bsoft\b.{0,60}\blimit\b|\bsoft\b.{0,60}\bcpu\b.{0,100}\blimit\b/i],
  ['memory_limit', /\b(?:memory|mem)\b.{0,100}\blimit\b|\b(?:out of memory|oom killed|memory limit exceeded)\b/i],
  ['wall_clock_limit', /\bwall[ -]?clock\b.{0,100}\blimit\b|\bwall[ -]?clock limit exceeded\b/i],
  ['function_runtime_failed', /\b(?:edge runtime|functions serve|function server)\b.{0,100}\b(?:failed|error|exited|unavailable)\b/i],
]);

const safeSignals = new Set([
  'SIGABRT', 'SIGALRM', 'SIGBUS', 'SIGCHLD', 'SIGCONT', 'SIGFPE', 'SIGHUP', 'SIGILL', 'SIGINT', 'SIGIO',
  'SIGIOT', 'SIGKILL', 'SIGPIPE', 'SIGPOLL', 'SIGPROF', 'SIGPWR', 'SIGQUIT', 'SIGSEGV', 'SIGSTKFLT',
  'SIGSTOP', 'SIGSYS', 'SIGTERM', 'SIGTRAP', 'SIGTSTP', 'SIGTTIN', 'SIGTTOU', 'SIGURG', 'SIGUSR1',
  'SIGUSR2', 'SIGVTALRM', 'SIGXCPU', 'SIGXFSZ',
]);
const safeSpawnCodes = new Set([
  'EACCES', 'EADDRINUSE', 'ECONNREFUSED', 'EEXIST', 'EINTR', 'EINVAL', 'EMFILE', 'ENFILE', 'ENOENT',
  'ENOMEM', 'ENOSPC', 'EPERM', 'EPIPE', 'ETIMEDOUT',
]);

/** Open an exclusive, private local diagnostics file suitable for child stdio. */
export function openFunctionServerLog(path) {
  return openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
}

export function closeFunctionServerLog(fd) {
  if (!Number.isInteger(fd) || fd < 0) throw new Error('FUNCTION_SERVER_LOG_FD_INVALID');
  closeSync(fd);
}

function readBoundedTail(logPath) {
  if (typeof logPath !== 'string' || !logPath) return '';
  let fd;
  try {
    const info = lstatSync(logPath);
    if (!info.isFile() || info.isSymbolicLink()) return '';
    fd = openSync(logPath, constants.O_RDONLY);
    const opened = fstatSync(fd);
    if (!opened.isFile()) return '';
    const length = Math.min(opened.size, FUNCTION_SERVER_LOG_TAIL_BYTES);
    if (!length) return '';
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, Math.max(0, opened.size - length));
    return buffer.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* the original startup failure remains primary */ }
    }
  }
}

function classifyOutput(value) {
  for (const [classification, pattern] of classifications) {
    if (pattern.test(value)) return classification;
  }
  return 'unknown';
}

function safeExitCode(value) {
  return Number.isInteger(value) && value >= 0 && value <= 255 ? value : null;
}

function safeSignalCode(value) {
  const signal = typeof value === 'string' ? value.toUpperCase() : '';
  return safeSignals.has(signal) ? signal : null;
}

function safeSpawnErrorCode(error) {
  const code = typeof error?.code === 'string' ? error.code.toUpperCase() : '';
  return safeSpawnCodes.has(code) ? code : null;
}

/** Return safe, finite failure metadata only. Never return or persist log text. */
export function getFunctionServerFailureDiagnostics({ logPath, exitCode = null, signalCode = null, spawnError = null } = {}) {
  const outputClass = classifyOutput(readBoundedTail(logPath));
  const spawnCode = safeSpawnErrorCode(spawnError);
  return Object.freeze({
    code: 'PERFORMANCE_FUNCTION_SERVER_FAILED',
    classification: spawnCode ? 'process_spawn_failed' : outputClass,
    exitCode: safeExitCode(exitCode),
    signalCode: safeSignalCode(signalCode),
    spawnErrorCode: spawnCode,
  });
}
