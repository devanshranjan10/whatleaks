import { chmod, writeFile } from 'node:fs/promises';
import type { Har } from './types.js';

export function serializeHar(har: Har): string {
  return `${JSON.stringify(har, null, 2)}\n`;
}

/**
 * HAR files hold raw traffic (tokens, identifiers), so they are readable by the
 * owner only. `chmod` covers the case where the file already existed.
 */
export async function writeHarFile(path: string, text: string): Promise<void> {
  await writeFile(path, text, { mode: 0o600 });
  await chmod(path, 0o600);
}
