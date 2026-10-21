import { describe, expect, it } from 'vitest';
import { buildMatchers } from '../src/analyze/identity.js';
import { buildReport } from '../src/analyze/report.js';
import { parseHar } from '../src/har/read.js';
import { renderMarkdown } from '../src/render/markdown.js';
import { renderTerminal } from '../src/render/terminal.js';
import { FAKE_IDS } from './helpers/fixtures.js';
import { harText, makeHar } from './helpers/har.js';

const MIB = 1024 * 1024;

// Bodies shaped to trip super-linear patterns: long runs of the characters an email,
// token, path or JSON pattern accepts, with the one character that completes a match
// missing. A 1 MiB upload of plain text once took hours to report.
const BODIES: Record<string, string> = {
  'one long word': 'b'.repeat(MIB),
  'local-part characters, no domain': 'a.b+c'.repeat(MIB / 5),
  'many at-signs, no dot after': 'x@'.repeat(MIB / 2),
  'email-like domain run': `a@${'b'.repeat(MIB - 8)}`,
  'path prefix repeated': '/Users/'.repeat(MIB / 7),
  'json keys without values': '{"k":'.repeat(MIB / 5),
  'header-like lines': 'Header-Name:\n'.repeat(MIB / 13),
  'query-like pairs': 'a=b&'.repeat(MIB / 4),
};

describe('reports stay linear on adversarial bodies', () => {
  const matchers = buildMatchers(FAKE_IDS);
  for (const [name, body] of Object.entries(BODIES)) {
    it(`1 MiB: ${name}`, () => {
      const t0 = performance.now();
      const report = buildReport(parseHar(harText(makeHar([{ at: 0, url: 'https://t.example/upload', contentType: 'text/plain', body }]))), { matchers, samples: 2 });
      renderTerminal(report);
      renderMarkdown(report);
      // Linear work on 1 MiB takes well under a second; the quadratic email pattern took hours.
      expect(performance.now() - t0).toBeLessThan(3000);
    });
  }
});
