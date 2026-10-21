import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';
import type { Identity } from './analyze/identity.js';

const run = promisify(execFile);

async function cmd(file: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await run(file, args, { timeout: 3000, windowsHide: true });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function machineId(): Promise<string | undefined> {
  if (process.platform === 'darwin') {
    const out = await cmd('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
    return out?.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1];
  }
  if (process.platform === 'linux') {
    for (const path of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
      try {
        const id = (await readFile(path, 'utf8')).trim();
        if (id) return id;
      } catch {
        // try the next one
      }
    }
    return undefined;
  }
  if (process.platform === 'win32') {
    const out = await cmd('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']);
    return out?.match(/MachineGuid\s+REG_SZ\s+(\S+)/)?.[1];
  }
  return undefined;
}

/**
 * Identifiers of this machine and user, read into memory only so payloads can be
 * searched for them. Nothing here is ever written to disk or printed. Every source
 * fails soft: a missing tool just means one fewer identifier.
 */
export async function localIdentities(): Promise<Identity[]> {
  const ids: Identity[] = [];
  const push = (kind: Identity['kind'], value: string | undefined): void => {
    if (value && value.trim()) ids.push({ kind, value: value.trim() });
  };

  try {
    push('username', os.userInfo().username);
  } catch {
    // no passwd entry (some containers)
  }
  const hostname = os.hostname();
  push('hostname', hostname);
  const short = hostname.replace(/\.(local|lan|home|localdomain)$/i, '');
  if (short !== hostname) push('hostname', short);
  push('home', os.homedir());

  const macs = new Set<string>();
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (!a.internal && a.mac && a.mac !== '00:00:00:00:00:00') macs.add(a.mac.toLowerCase());
    }
  }
  for (const mac of macs) push('mac', mac);

  const [mid, email, name] = await Promise.all([
    machineId(),
    cmd('git', ['config', '--global', '--get', 'user.email']),
    cmd('git', ['config', '--global', '--get', 'user.name']),
  ]);
  push('machine-id', mid);
  push('git-email', email);
  push('git-name', name);
  return ids;
}
