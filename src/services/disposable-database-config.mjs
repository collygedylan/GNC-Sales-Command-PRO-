import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function allocateLoopbackPorts(count) {
  if (count === 0) return [];
  const program = `
    const net = await import('node:net');
    const servers = [];
    try {
      for (let index = 0; index < Number(process.argv[1]); index++) {
        const server = net.createServer();
        servers.push(server);
        await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
      }
      process.stdout.write(JSON.stringify(servers.map(server => server.address().port)));
    } finally { await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', program, String(count)], {
    encoding: 'utf8', timeout: 10000, windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error('DISPOSABLE_DATABASE_PORT_PROBE_FAILED');
  return JSON.parse(result.stdout);
}

export function disposableDatabaseConfig(config, projectId, allocate = allocateLoopbackPorts) {
  if (!/^project_id\s*=\s*"[^"]+"\s*$/m.test(config)) throw new Error('DATABASE_PROJECT_ID_CONFIG_INVALID');
  const matches = [...config.matchAll(/^(?:port|shadow_port)\s*=\s*(\d+)\s*$/gm)];
  const originalPorts = [...new Set(matches.map(match => Number(match[1])))];
  const ports = allocate(originalPorts.length);
  if (ports.length !== originalPorts.length || new Set(ports).size !== ports.length
    || ports.some(port => !Number.isInteger(port) || port < 1024 || port > 65535)) {
    throw new Error('DISPOSABLE_DATABASE_PORTS_INVALID');
  }
  const mapped = new Map(originalPorts.map((port, index) => [port, ports[index]]));
  return config.replace(/^project_id\s*=\s*"[^"]+"\s*$/m, `project_id = "${projectId}"`)
    .replace(/^(port|shadow_port)\s*=\s*(\d+)\s*$/gm, (_, key, port) => `${key} = ${mapped.get(Number(port))}`);
}

export function writeHistoricalRuntime(root, destination, projectId) {
  const config = readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
  writeFileSync(path.join(destination, 'supabase/config.toml'), disposableDatabaseConfig(config, projectId));
  for (const relative of ['supabase/functions', 'services', 'utils/auraLingo.js', 'src']) {
    const source = path.join(root, relative);
    if (relative === 'src' && !existsSync(source)) continue;
    const target = path.join(destination, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true, force: false, errorOnExist: true });
  }
}
