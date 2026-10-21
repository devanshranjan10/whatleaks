import { OPT_OUTS } from '../catalog/optouts.js';
import { renderJson } from '../render/json.js';
import { table } from '../render/format.js';
import type { Io } from './output.js';

export function optOutsCommand(opts: { json: boolean }, io: Io): number {
  if (opts.json) {
    io.stdout(renderJson(OPT_OUTS));
    return 0;
  }
  io.stdout(`${OPT_OUTS.length} documented opt-out variables (set by \`compare\` and \`run --opt-out\`):\n\n`);
  const rows = OPT_OUTS.map((o) => [`${o.name}=${o.value}`, o.tools.join(', ') + (o.note ? ` (${o.note})` : '')]);
  io.stdout(`${table(rows, ['l', 'l']).join('\n')}\n\nSources: whatleaks opt-outs --json\n`);
  return 0;
}
