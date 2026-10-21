import { randomBytes } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { Har } from './types.js';

export function serializeHar(har: Har): string {
  return `${JSON.stringify(har, null, 2)}\n`;
}

/**
 * Write a file atomically with the given mode: a new temp file is created exclusively
 * (never an existing file, never through a symlink) with that mode, then renamed into
 * place. Raw traffic therefore never sits in a file someone else can read.
 */
export async function writeFileSafe(path: string, text: string, mode: number): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
  const handle = await open(tmp, 'wx', mode);
  try {
    await handle.writeFile(text);
    await handle.chmod(mode);
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** HAR files hold raw traffic (tokens, identifiers), so they are readable by the owner only. */
export async function writeHarFile(path: string, text: string): Promise<void> {
  await writeFileSafe(path, text, 0o600);
}
