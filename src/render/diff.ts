import { type Diff, type EndpointDiff, isTelemetry } from '../diff/diff.js';
import { VERSION } from '../version.js';
import { type Colors, bytes, clip, colors, commandLine, duration, plural } from './format.js';
import { cell } from './markdown.js';

function catLabel(e: EndpointDiff): string {
  const c = e.classification;
  return c.basis === 'catalog' ? `${c.category} · ${c.vendor ?? 'catalog'}` : c.basis === 'heuristic' ? `${c.category}?` : c.category;
}

function counts(e: EndpointDiff): string {
  return `${e.before?.count ?? 0} → ${e.after?.count ?? 0}`;
}

function runLine(label: string, r: Diff['before']): string {
  return `${label} "${r.label}" (${duration(r.durationMs)}, ${plural(r.requests, 'request')})`;
}

function headlineText(d: Diff): string {
  const h = d.headline;
  const n = h.telemetryEndpointsBefore;
  if (n === 0 && h.telemetryEndpointsNew === 0) return 'No telemetry endpoints were seen in either run.';
  const still = h.telemetryEndpointsStill + h.telemetryEndpointsNew;
  if (still === 0) return n === 1 ? 'The telemetry endpoint stopped after opting out.' : `All ${n} telemetry endpoints stopped after opting out.`;
  if (h.telemetryEndpointsNew === 0 && h.telemetryEndpointsStill === n) {
    return n === 1 ? 'The telemetry endpoint was still contacted after opting out.' : `All ${n} telemetry endpoints were still contacted after opting out.`;
  }
  const extra = h.telemetryEndpointsNew ? `, plus ${h.telemetryEndpointsNew} new` : '';
  return `${plural(still, 'telemetry endpoint')} still contacted after opting out: ${h.telemetryEndpointsStill} of the ${n} from the first run${extra}.`;
}

function endpointLines(e: EndpointDiff, c: Colors): string[] {
  const icon = e.status === 'stopped' ? c.green('✓') : e.status === 'new' ? c.red('+') : isTelemetry(e.classification.category) ? c.red('●') : c.dim('·');
  const lines = [`  ${icon} ${e.method} ${e.host}${e.pathTemplate}  ${c.dim(catLabel(e))}  ${counts(e)} requests`];
  if (e.status === 'still' && e.fieldsStill.length) {
    lines.push(`      still sent: ${clip(e.fieldsStill.slice(0, 10).join(', '), 300)}${e.fieldsStill.length > 10 ? ` …+${e.fieldsStill.length - 10}` : ''}`);
  }
  if (e.fieldsDropped.length) lines.push(`      ${c.dim(`no longer sent: ${clip(e.fieldsDropped.join(', '), 300)}`)}`);
  if (e.fieldsAdded.length) lines.push(`      ${c.dim(`newly sent: ${clip(e.fieldsAdded.join(', '), 300)}`)}`);
  return lines;
}

export function renderDiffTerminal(d: Diff, opts: { color?: boolean } = {}): string {
  const c = colors(opts.color ?? false);
  const out: string[] = [];
  out.push(`${c.bold('whatleaks diff')} · ${runLine('before', d.before)} → ${runLine('after', d.after)}`);
  if (d.after.command.length) out.push(c.dim(`command: ${commandLine(d.after.command)}`));
  if (d.after.optOutEnv.length) out.push(c.dim(`opted out with: ${clip(d.after.optOutEnv.join(' '), 200)}`));
  out.push('', c.bold(headlineText(d)));
  out.push(`Telemetry requests: ${d.headline.telemetryRequestsBefore} → ${d.headline.telemetryRequestsAfter} · all requests: ${d.before.requests} → ${d.after.requests}`);

  const tel = (s: EndpointDiff['status']): EndpointDiff[] => d.endpoints.filter((e) => e.status === s && isTelemetry(e.classification.category));
  const sections: Array<[string, EndpointDiff[]]> = [
    ['STILL SENDING AFTER OPT-OUT', tel('still')],
    ['NEW AFTER OPT-OUT', tel('new')],
    ['STOPPED', tel('stopped')],
  ];
  for (const [title, eps] of sections) {
    if (eps.length === 0) continue;
    out.push('', c.bold(title));
    for (const e of eps) out.push(...endpointLines(e, c));
  }
  const other = d.endpoints.filter((e) => !isTelemetry(e.classification.category));
  if (other.length) {
    out.push('', c.bold('OTHER TRAFFIC'), c.dim('  (not identified as telemetry; check it yourself)'));
    for (const e of other) out.push(`  ${e.status === 'stopped' ? '-' : e.status === 'new' ? '+' : '='} ${e.method} ${e.host}${e.pathTemplate}  ${c.dim(catLabel(e))}  ${counts(e)}`);
  }

  if (d.findingsStill.length || d.findingsStopped.length) {
    out.push('', c.bold('STILL SENT ABOUT YOU'));
    if (d.findingsStill.length === 0) out.push(`  ${c.green('✓')} nothing identifying in the second run's visible traffic`);
    for (const f of d.findingsStill) {
      const forms = f.forms.filter((x) => x !== 'raw');
      out.push(`  ${f.severity === 'high' ? c.red('●') : c.yellow('○')} ${f.title}${forms.length ? ` (as ${forms.join(', ')})` : ''} — ${plural(f.requests, 'request')}, in ${clip(f.locations.join(', '), 90)}`);
    }
    if (d.findingsStopped.length) out.push(c.dim(`  no longer sent: ${d.findingsStopped.join(', ')}`));
  }
  if (d.persistentIds.length) {
    out.push('', c.bold('PERSISTENT IDENTIFIERS'), c.dim('  same value in both runs, so it is stored on disk and survives a restart'));
    for (const p of d.persistentIds.slice(0, 12)) out.push(`  ${c.yellow('○')} ${p.display} at ${clip(p.locations.join(', '), 80)} → ${clip(p.endpoints.join(', '), 80)}`);
    if (d.persistentIds.length > 12) out.push(c.dim(`  …+${d.persistentIds.length - 12} more (see --md)`));
  }
  if (d.caveats.length) {
    out.push('', c.bold('NOTES'));
    for (const n of d.caveats) out.push(`  • ${n}`);
  }
  return `${out.join('\n')}\n`;
}

export function renderDiffMarkdown(d: Diff): string {
  const out: string[] = [];
  const cmd = d.after.command.length ? `: \`${commandLine(d.after.command)}\`` : '';
  out.push(`# whatleaks diff${cmd}`, '');
  out.push(`- Before: \`${d.before.label}\`, ${duration(d.before.durationMs)}, ${plural(d.before.requests, 'request')}`);
  out.push(`- After: \`${d.after.label}\`, ${duration(d.after.durationMs)}, ${plural(d.after.requests, 'request')}`);
  if (d.after.optOutEnv.length) out.push(`- Opt-out variables in the second run: ${d.after.optOutEnv.map((n) => `\`${n}\``).join(' ')}`);
  out.push('', `**${headlineText(d)}** Telemetry requests went from ${d.headline.telemetryRequestsBefore} to ${d.headline.telemetryRequestsAfter}.`, '');

  out.push('## Endpoints', '');
  out.push('| | Endpoint | Category | Requests before → after | Fields still sent | Fields no longer sent |', '|---|---|---|---|---|---|');
  for (const e of d.endpoints) {
    const icon = e.status === 'stopped' ? '✅ stopped' : e.status === 'new' ? '🆕 new' : isTelemetry(e.classification.category) ? '🔴 still' : 'still';
    const fmt = (xs: string[]): string => (xs.length ? xs.map((x) => `\`${cell(x)}\``).join(', ') : '');
    out.push(`| ${icon} | \`${cell(`${e.method} ${e.host}${e.pathTemplate}`)}\` | ${cell(catLabel(e))} | ${counts(e)} | ${fmt(e.fieldsStill)} | ${fmt(e.fieldsDropped)} |`);
  }
  out.push('');
  out.push('## Still sent about you', '');
  if (d.findingsStill.length === 0) out.push('Nothing identifying was found in the second run\'s visible traffic.', '');
  else {
    out.push('| Finding | Requests | Where | Form |', '|---|---:|---|---|');
    for (const f of d.findingsStill) out.push(`| ${cell(f.title)} | ${f.requests} | ${f.locations.map((l) => `\`${cell(l)}\``).join(', ')} | ${f.forms.join(', ')} |`);
    out.push('');
  }
  if (d.findingsStopped.length) out.push(`No longer sent: ${d.findingsStopped.join(', ')}.`, '');
  if (d.persistentIds.length) {
    out.push('## Persistent identifiers', '', 'The same value was sent in both runs, so it is stored on disk and identifies this machine or install across restarts.', '');
    for (const p of d.persistentIds) out.push(`- \`${cell(p.display)}\` at ${p.locations.map((l) => `\`${cell(l)}\``).join(', ')} (${p.endpoints.map((x) => `\`${cell(x)}\``).join(', ')})`);
    out.push('');
  }
  if (d.caveats.length) {
    out.push('## Notes', '');
    for (const n of d.caveats) out.push(`- ${n}`);
    out.push('');
  }
  out.push('---', '', `Generated by whatleaks ${VERSION}.${d.redacted ? ' Redacted: identifiers are labelled and ids masked.' : ' **Not redacted.**'} Sizes are approximate (${bytes(0)} = empty).`);
  return `${out.join('\n')}\n`;
}
