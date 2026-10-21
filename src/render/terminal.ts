import type { Endpoint, FieldStat, Finding, Report } from '../model.js';
import { TELEMETRY_CATEGORIES } from '../model.js';
import { destinationCategory, repeatedIds } from './labels.js';
import { type Colors, bytes, clip, colors, commandLine, duration, offset, plural, sparkline, table } from './format.js';

export interface TerminalOptions {
  color?: boolean;
  /** Lines of payload sample shown per telemetry endpoint. Default 14. */
  sampleLines?: number;
  /** Fields listed per endpoint. Default 8. */
  fieldsPerEndpoint?: number;
}

function categoryLabel(ep: Endpoint): string {
  const c = ep.classification;
  if (c.basis === 'catalog') return `${c.category} · ${c.vendor ?? 'catalog'}`;
  if (c.basis === 'heuristic') return `${c.category}?`;
  return c.category;
}

function fieldTag(f: FieldStat): string {
  const tags: string[] = [];
  if (f.idLike) tags.push('id');
  if (f.constant) tags.push('same every time');
  return tags.length ? ` (${tags.join(', ')})` : '';
}

function findingLine(f: Finding, c: Colors, report: Report): string[] {
  const bullet = f.severity === 'high' ? c.red('●') : c.yellow('○');
  if (f.kind === 'stable-id') {
    const ids = repeatedIds(report).slice(0, 3).map((r) => `${r.display} ×${r.requests}`);
    const more = repeatedIds(report).length > 3 ? `, +${repeatedIds(report).length - 3} more` : '';
    return [
      `  ${bullet} ${c.bold(f.title)}: ${plural(repeatedIds(report).length, 'id')} reused across requests (${ids.join(', ')}${more})`,
      `      ${c.dim(`in ${clip(f.locations.join(', '), 100)}`)}`,
    ];
  }
  const forms = f.forms.filter((x) => x !== 'raw');
  const how = forms.length ? ` ${c.dim(`as ${forms.join(', ')}${f.forms.includes('raw') ? ' and plain' : ''}`)}` : '';
  const hosts = [...new Set(f.endpoints.map((k) => k.split(' ')[1]!.split('/')[0]!))];
  return [
    `  ${bullet} ${c.bold(f.title)}${how} — ${plural(f.requests, 'request')} to ${hosts.join(', ')}`,
    `      ${c.dim(`in ${clip(f.locations.join(', '), 100)}`)}`,
  ];
}

function endpointBlock(ep: Endpoint, c: Colors, opts: Required<TerminalOptions>): string[] {
  const lines: string[] = [];
  const telemetry = TELEMETRY_CATEGORIES.includes(ep.classification.category);
  const title = `${ep.method} ${ep.host}${ep.pathTemplate}`;
  lines.push(`  ${telemetry ? c.bold(title) : title}  ${c.dim(categoryLabel(ep))}`);
  const stats = [plural(ep.count, 'request'), `first ${offset(ep.firstMs)}`];
  if (ep.medianGapMs !== null) stats.push(`every ~${duration(ep.medianGapMs)}`);
  if (ep.perMinute !== null) stats.push(`${ep.perMinute}/min`);
  stats.push(`≈${bytes(ep.approxBytes)}`);
  const statuses = Object.entries(ep.statuses)
    .map(([s, n]) => (n > 1 ? `${s}×${n}` : s))
    .join(' ');
  lines.push(`      ${stats.join(' · ')} · ${c.dim(`status ${statuses}`)}`);
  if (ep.fields.length > 0) {
    const shown = ep.fields.slice(0, opts.fieldsPerEndpoint).map((f) => `${f.path}${fieldTag(f)}`);
    const more = ep.fields.length > shown.length ? ` …+${ep.fields.length - shown.length}` : '';
    lines.push(`      fields: ${clip(shown.join(', '), 400)}${more}`);
  }
  const sample = ep.samples[0];
  if (telemetry && sample && sample.body && opts.sampleLines > 0) {
    const body = sample.body.split('\n');
    const shown = body.slice(0, opts.sampleLines);
    lines.push(`      ${c.dim(`sample (${offset(sample.offsetMs)}):`)}`);
    for (const l of shown) lines.push(`        ${c.dim(clip(l, 120))}`);
    if (body.length > shown.length) lines.push(`        ${c.dim(`… ${body.length - shown.length} more lines (see --md)`)}`);
  }
  return lines;
}

export function renderTerminal(report: Report, options: TerminalOptions = {}): string {
  const opts: Required<TerminalOptions> = { color: false, sampleLines: 14, fieldsPerEndpoint: 8, ...options };
  const c = colors(opts.color);
  const out: string[] = [];
  const cap = report.capture;
  const t = report.totals;

  const head = [c.bold('whatleaks'), cap.command.length ? clip(commandLine(cap.command), 80) : cap.label, duration(cap.durationMs)];
  if (cap.exitCode !== null) head.push(`exit ${cap.exitCode}`);
  if (cap.stoppedBy && cap.stoppedBy !== 'exit') head.push(`stopped by ${cap.stoppedBy}`);
  out.push(head.join(' · '));
  if (cap.optOutEnv.length) out.push(c.dim(`opt-out variables set: ${clip(cap.optOutEnv.join(' '), 160)}`));
  out.push(
    `${plural(t.requests, 'request')} to ${plural(t.destinations, 'destination')} · ≈${bytes(t.approxBytes)} sent · ${c.bold(
      `${t.telemetryRequests} to telemetry endpoints`,
    )}`,
  );
  if (t.requests > 0) out.push(c.dim(`activity |${sparkline(report.timeline)}| over ${duration(cap.durationMs)}`));

  if (report.findings.length > 0) {
    out.push('', c.bold('WHAT IT SENT ABOUT YOU'));
    for (const f of report.findings) out.push(...findingLine(f, c, report));
  } else if (t.requests > 0) {
    out.push('', c.bold('WHAT IT SENT ABOUT YOU'), `  ${c.green('✓')} No local identifiers, emails or file paths found in the visible traffic.`);
  }

  if (report.destinations.length > 0) {
    out.push('', c.bold('WHERE IT WENT'));
    const rows = [['DESTINATION', 'CATEGORY', 'REQUESTS', 'SENT'].map((h) => c.dim(h))];
    for (const d of report.destinations) {
      rows.push([d.host, destinationCategory(report, d), String(d.requests), `≈${bytes(d.approxBytes)}`]);
    }
    out.push(...table(rows, ['l', 'l', 'r', 'r']));
    if (report.endpoints.some((e) => e.classification.basis === 'heuristic')) {
      out.push(c.dim('  "?" = guessed from the URL, not from the known-host catalog'));
    }
  }

  if (report.endpoints.length > 0) {
    out.push('', c.bold('ENDPOINTS'));
    for (const ep of report.endpoints) out.push(...endpointBlock(ep, c, opts));
  }

  const hidden = report.refused.length + report.direct.length + report.passthrough.length;
  if (hidden > 0) {
    out.push('', c.bold('NOT VISIBLE TO WHATLEAKS'));
    for (const r of report.refused) {
      out.push(`  ${c.red('✗')} ${r.host} — ${plural(r.count, 'connection')} did not accept the whatleaks certificate (${r.cause}); contents unknown`);
    }
    for (const p of report.passthrough) {
      out.push(`  ${c.yellow('↷')} ${p.host}:${p.port} — ${plural(p.count, 'connection')} tunnelled without decrypting (--passthrough)`);
    }
    for (const d of report.direct) {
      const name = d.rdns ? ` (${d.rdns})` : '';
      out.push(`  ${c.yellow('↷')} ${d.remote}:${d.port}${name} ${d.protocol} — direct connection by ${d.process}, bypassed the proxy`);
    }
  }

  if (report.caveats.length > 0) {
    out.push('', c.bold('NOTES'));
    for (const n of report.caveats) out.push(`  • ${n}`);
  }
  if (report.redacted) out.push('', c.dim('Redacted: ‹labels› replace local identifiers and secrets; ids are masked. Use --raw to see everything.'));
  return `${out.join('\n')}\n`;
}
