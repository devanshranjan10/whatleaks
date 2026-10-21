import pc from 'picocolors';

export type Colors = ReturnType<typeof pc.createColors>;

export function colors(enabled: boolean): Colors {
  return pc.createColors(enabled);
}

export function wantsColor(stream: NodeJS.WriteStream, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0') return true;
  return stream.isTTY === true;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function offset(ms: number): string {
  return `+${(ms / 1000).toFixed(1)}s`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const BARS = ' ▁▂▃▄▅▆▇█';

export function sparkline(counts: number[]): string {
  const max = Math.max(0, ...counts);
  if (max === 0) return ' '.repeat(counts.length);
  return counts.map((c) => (c === 0 ? ' ' : BARS[Math.max(1, Math.round((c / max) * 8))]!)).join('');
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

export function visibleLength(s: string): number {
  return s.replace(ANSI, '').length;
}

function pad(s: string, width: number, align: 'l' | 'r'): string {
  const fill = ' '.repeat(Math.max(0, width - visibleLength(s)));
  return align === 'l' ? s + fill : fill + s;
}

/** Plain-text table with per-column alignment; widths ignore ANSI color codes. */
export function table(rows: string[][], aligns: Array<'l' | 'r'>, indent = '  '): string[] {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, visibleLength(cell))));
  return rows.map((row) => indent + row.map((cell, i) => pad(cell, widths[i]!, aligns[i] ?? 'l')).join('  ').trimEnd());
}

export function commandLine(argv: string[]): string {
  return argv.map((a) => (/^[\w@%+=:,./‹›()-]+$/.test(a) ? a : `'${a.replaceAll("'", "'\\''")}'`)).join(' ');
}

export function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
