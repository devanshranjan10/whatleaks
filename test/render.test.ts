import { describe, expect, it } from 'vitest';
import { buildMatchers } from '../src/analyze/identity.js';
import { buildReport } from '../src/analyze/report.js';
import { parseHar } from '../src/har/read.js';
import { bytes, commandLine, duration, sparkline, table, visibleLength } from '../src/render/format.js';
import { renderMarkdown } from '../src/render/markdown.js';
import { renderTerminal } from '../src/render/terminal.js';
import { VERSION } from '../src/version.js';
import { FAKE_IDS, TEST_RULES, chattyHar } from './helpers/fixtures.js';
import { harText, makeHar } from './helpers/har.js';

const matchers = buildMatchers(FAKE_IDS);
const withHidden = (): ReturnType<typeof chattyHar> => {
  const har = chattyHar();
  har.log._whatleaks!.refused = [{ host: 'pinned.example', count: 3, cause: 'cert-rejected', firstAt: '', lastAt: '' }];
  har.log._whatleaks!.direct = [
    { remote: '140.82.112.3', port: 443, protocol: 'TCP', process: 'git', firstAt: '', lastAt: '', samples: 2, rdns: 'lb-140-82-112-3-iad.github.com' },
  ];
  har.log._whatleaks!.passthrough = [{ host: 'bank.example', port: 443, count: 1, firstAt: '', lastAt: '' }];
  return har;
};
const report = buildReport(parseHar(harText(withHidden())), { matchers, rules: TEST_RULES });

describe('format helpers', () => {
  it('formats bytes, durations and sparklines', () => {
    expect([bytes(512), bytes(2048), bytes(3 * 1024 * 1024)]).toEqual(['512 B', '2.0 KB', '3.0 MB']);
    expect([duration(850), duration(12_340), duration(245_000), duration(3_720_000)]).toEqual(['850 ms', '12.3 s', '4m 05s', '1h 02m']);
    expect(sparkline([0, 1, 4, 8])).toBe(' ▁▄█');
    expect(sparkline([0, 0])).toBe('  ');
  });

  it('aligns tables ignoring ANSI codes and quotes command lines', () => {
    expect(table([['a', '\u001b[31mbb\u001b[39m'], ['ccc', 'd']], ['l', 'r'])).toEqual(['  a    \u001b[31mbb\u001b[39m', '  ccc   d']);
    expect(visibleLength('\u001b[1mabc\u001b[22m')).toBe(3);
    expect(commandLine(['npx', 'next', 'build', "it's here"])).toBe("npx next build 'it'\\''s here'");
  });
});

describe('renderers', () => {
  it('renders the terminal report', async () => {
    await expect(renderTerminal(report)).toMatchFileSnapshot('golden/report.txt');
  });

  it('renders the Markdown report', async () => {
    // The footer names the running version; the golden file says <version>, so a release doesn't change it.
    await expect(renderMarkdown(report).replace(`whatleaks ${VERSION}.`, 'whatleaks <version>.')).toMatchFileSnapshot('golden/report.md');
  });

  it('colors only when asked', () => {
    expect(renderTerminal(report)).not.toContain('\u001b[');
    expect(renderTerminal(report, { color: true })).toContain('\u001b[');
  });

  it('never prints identifiers or secrets in redacted output', () => {
    const both = renderTerminal(report) + renderMarkdown(report);
    for (const s of ['janedoe', 'jane@doe.dev', 'sk_live', 'janes-mbp', 'Jane Doe', '0f8fad5b-d9cb']) expect(both).not.toContain(s);
  });

  it('says so when nothing identifying was found, and handles empty captures', () => {
    const clean = buildReport(parseHar(harText(makeHar([{ at: 0, url: 'https://registry.npmjs.org/x' }]))), { matchers });
    expect(renderTerminal(clean)).toContain('No local identifiers, emails or file paths found');
    const empty = buildReport(parseHar(harText(makeHar([]))), { matchers });
    expect(renderTerminal(empty)).toContain('0 requests to 0 destinations');
    expect(renderMarkdown(empty)).toContain('| Requests | 0 |');
  });
});
