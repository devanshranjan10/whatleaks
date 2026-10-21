import type { Endpoint, Report } from '../model.js';
import { destinationCategory } from './labels.js';
import { bytes, commandLine, duration, offset, plural, sparkline } from './format.js';
import { VERSION } from '../version.js';
import { repeatedIds } from './labels.js';

/** Escape text for a Markdown table cell. */
export function cell(s: string): string {
  return s.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

/** An inline code span that cannot be broken out of: the fence is longer than any backtick run inside. */
export function code(s: string): string {
  const body = s.replaceAll('\n', ' ');
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((r) => r.length));
  const fence = '`'.repeat(longest + 1);
  const pad = body.startsWith('`') || body.endsWith('`') || longest > 0 ? ' ' : '';
  return `${fence}${pad}${body}${pad}${fence}`;
}

function fence(lang: string, body: string): string[] {
  const longest = Math.max(2, ...(body.match(/`+/g) ?? []).map((r) => r.length));
  const ticks = '`'.repeat(longest + 1);
  return [`${ticks}${lang}`, body, ticks];
}

function classificationText(ep: Endpoint): string {
  const c = ep.classification;
  if (c.basis === 'catalog') return `${c.category} (known host: ${c.reason})`;
  if (c.basis === 'heuristic') return `${c.category}? (guessed from ${c.reason})`;
  return 'other';
}

function endpointSection(ep: Endpoint): string[] {
  const out: string[] = [];
  out.push(`### ${code(`${ep.method} ${ep.host}${ep.pathTemplate}`)}`, '');
  const stats = [`**${plural(ep.count, 'request')}**`, `first at ${offset(ep.firstMs)}`, `last at ${offset(ep.lastMs)}`];
  if (ep.medianGapMs !== null) stats.push(`median gap ${duration(ep.medianGapMs)}`);
  if (ep.perMinute !== null) stats.push(`${ep.perMinute}/min`);
  stats.push(`≈${bytes(ep.approxBytes)} sent`);
  out.push(`- ${stats.join(' · ')}`);
  out.push(`- Category: ${classificationText(ep)}`);
  out.push(`- Status: ${Object.entries(ep.statuses).map(([s, n]) => `${s} ×${n}`).join(', ')}`);
  out.push(`- Body: ${Object.entries(ep.bodyFormats).map(([f, n]) => `${f} ×${n}`).join(', ')}`);
  if (ep.userAgents.length) out.push(`- User-Agent: ${ep.userAgents.map(code).join(', ')}`);
  if (ep.websocketMessages) out.push(`- WebSocket messages sent: ${ep.websocketMessages}`);
  out.push('');
  if (ep.fields.length > 0) {
    out.push('| Field | Seen in | Distinct | Example | Notes |', '|---|---:|---:|---|---|');
    for (const f of ep.fields) {
      const notes = [f.idLike ? 'id-like' : '', f.constant ? 'same every time' : ''].filter(Boolean).join(', ');
      const distinct = f.distinct > 50 ? '50+' : String(f.distinct);
      out.push(`| ${cell(code(f.path))} | ${f.seenIn}/${ep.count} | ${distinct} | ${f.examples[0] !== undefined ? cell(code(f.examples[0])) : ''} | ${notes} |`);
    }
    out.push('');
  }
  ep.samples.forEach((s, i) => {
    out.push(`<details><summary>Sample ${i + 1} at ${offset(s.offsetMs)}${s.truncated ? ' (truncated)' : ''}</summary>`, '');
    out.push(`URL: ${code(s.url)}`, '');
    if (s.body) out.push(...fence(s.format === 'json' || s.format === 'ndjson' || s.format === 'form' ? 'json' : 'text', s.body), '');
    out.push('</details>', '');
  });
  return out;
}

export function renderMarkdown(report: Report): string {
  const cap = report.capture;
  const t = report.totals;
  const out: string[] = [];
  const what = cap.command.length ? code(commandLine(cap.command)) : cell(cap.label);
  out.push(`# whatleaks report: ${what}`, '');
  out.push(`Captured ${cap.startedAt} for ${duration(cap.durationMs)}${cap.exitCode !== null ? `, exit code ${cap.exitCode}` : ''}. Label: \`${cap.label}\`. Source: ${cap.creator}.`, '');
  if (cap.optOutEnv.length) out.push(`Opt-out variables set for this run: ${cap.optOutEnv.map(code).join(' ')}`, '');

  out.push('## Summary', '');
  out.push('| | |', '|---|---|');
  out.push(`| Requests | ${t.requests} |`);
  out.push(`| Destinations | ${t.destinations} |`);
  out.push(`| Endpoints | ${t.endpoints} |`);
  out.push(`| Sent (approx.) | ${bytes(t.approxBytes)} |`);
  out.push(`| To known telemetry endpoints | ${t.telemetryRequests} |`);
  if (t.guessedTelemetryRequests) out.push(`| To endpoints guessed to be telemetry | ${t.guessedTelemetryRequests} |`);
  out.push(`| Connections not inspectable | ${t.refusedConnections + report.passthrough.reduce((n, p) => n + p.count, 0)} |`);
  out.push(`| Direct connections (bypassed proxy) | ${t.directConnections} |`);
  if (t.requests > 0) out.push(`| Activity | \`${sparkline(report.timeline)}\` |`);
  out.push('');

  out.push('## What it sent about you', '');
  if (report.findings.length === 0) {
    out.push('No local identifiers, emails or file paths were found in the visible traffic.', '');
  } else {
    out.push('| | Finding | Requests | Where | Form |', '|---|---|---:|---|---|');
    for (const f of report.findings) {
      const icon = f.severity === 'high' ? '🔴' : '🟡';
      out.push(`| ${icon} | ${cell(f.title)} | ${f.requests} | ${f.locations.map((l) => cell(code(l))).join(', ')} | ${f.forms.join(', ')} |`);
    }
    out.push('');
    if (repeatedIds(report).length) {
      out.push('Repeated identifiers (same value in several requests; compare two runs with `whatleaks diff` to see which survive a restart):', '');
      for (const r of repeatedIds(report).slice(0, 20)) {
        out.push(`- ${code(r.display)} in ${plural(r.requests, 'request')}, at ${r.locations.map(code).join(', ')}`);
      }
      out.push('');
    }
  }

  out.push('## Where it went', '');
  out.push('| Destination | Category | Requests | Sent (approx.) |', '|---|---|---:|---:|');
  for (const d of report.destinations) out.push(`| ${code(d.host)} | ${cell(destinationCategory(report, d))} | ${d.requests} | ${bytes(d.approxBytes)} |`);
  out.push('');

  out.push('## Endpoints', '');
  for (const ep of report.endpoints) out.push(...endpointSection(ep));

  if (report.refused.length + report.passthrough.length + report.direct.length > 0) {
    out.push('## Not visible to whatleaks', '');
    for (const r of report.refused) out.push(`- ${code(r.host)}: ${plural(r.count, 'connection')} did not accept the whatleaks certificate (${r.cause}). Contents unknown.`);
    for (const p of report.passthrough) out.push(`- ${code(`${p.host}:${p.port}`)}: ${plural(p.count, 'connection')} tunnelled without decrypting (\`--passthrough\`).`);
    for (const d of report.direct) {
      const what = d.connections && d.connections > 1 ? `${d.connections} direct connections` : 'direct connection';
      out.push(`- ${code(`${d.remote}${d.truncated ? '…' : ''}:${d.port}`)}${d.rdns ? ` (${code(d.rdns)})` : ''} ${d.protocol}: ${what} by \`${d.process}\` that bypassed the proxy.`);
    }
    out.push('');
  }
  if (report.caveats.length) {
    out.push('## Notes', '');
    for (const n of report.caveats) out.push(`- ${n}`);
    out.push('');
  }
  out.push('---', '');
  out.push(
    `Generated by whatleaks ${VERSION}. ${report.redacted ? 'Redacted: `‹labels›` replace local identifiers and secrets, and ids are replaced by aliases (‹id-1›, …).' : '**Not redacted** (`--raw`).'} Classification marked "?" is a guess from the URL.`,
  );
  return `${out.join('\n')}\n`;
}
