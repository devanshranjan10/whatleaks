// Builds whatleaks.me: copies site/ to .site-dist/, filling in the shared nav and footer partials, the logo and the
// dot-matrix illustrations, and writes the agent-readable copies: /<page>.md for every page, /llms-full.txt, and
// FAQPage JSON-LD. Usage: node scripts/site/build.mjs
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const ORIGIN = 'https://whatleaks.me';
const REPO = 'https://github.com/devanshranjan10/whatleaks';
const UPDATED = new Date().toISOString().slice(0, 10);
const root = fileURLToPath(new URL('../../', import.meta.url));
const src = join(root, 'site');
const out = join(root, '.site-dist');

// ---------- logo: a droplet of dots, the last one red (what leaks) ----------
const DROP = [[12, 3], [12, 6], [9, 9], [12, 9], [15, 9], [6, 12], [9, 12], [12, 12], [15, 12], [18, 12], [6, 15], [9, 15], [12, 15], [15, 15], [18, 15], [6, 18], [9, 18], [12, 18], [15, 18], [18, 18], [9, 21], [15, 21], [12, 21]];
const logo = `<svg viewBox="1 1 22 22" aria-hidden="true">${DROP.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="1.3" fill="${i === DROP.length - 1 ? '#d03b3b' : '#2a78d6'}"/>`).join('')}</svg>`;

// ---------- dot-matrix illustrations ----------
// A grid of characters: '#' blue dot, '+' light blue, 'o' hollow blue, 'r' red (what leaks), '.' faint grid, ' ' none.
function canvas(cols, rows) {
  const g = Array.from({ length: rows }, () => Array(cols).fill('.'));
  const set = (c, r, ch) => { if (r >= 0 && r < rows && c >= 0 && c < cols) g[r][c] = ch; };
  return {
    g, set,
    rect(c0, r0, c1, r1, ch) { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) set(c, r, ch); },
    outline(c0, r0, c1, r1, ch) { for (let c = c0; c <= c1; c++) { set(c, r0, ch); set(c, r1, ch); } for (let r = r0; r <= r1; r++) { set(c0, r, ch); set(c1, r, ch); } },
    h(r, c0, c1, ch) { for (let c = c0; c <= c1; c++) set(c, r, ch); },
    v(c, r0, r1, ch) { for (let r = r0; r <= r1; r++) set(c, r, ch); },
  };
}
const ART = {
  key() {
    const k = canvas(28, 10);
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
      const d = Math.hypot(c - 4.5, r - 4.5);
      if (Math.abs(d - 3.7) < 0.55) k.set(c, r, '#');
      else if (Math.abs(d - 1.6) < 0.5) k.set(c, r, '+');
    }
    k.rect(8, 4, 24, 5, '#');
    for (const c of [18, 20, 22, 23]) k.v(c, 6, 7, '#');
    k.set(26, 4, 'r'); k.set(26, 5, 'o');
    return k.g;
  },
  tree() {
    const t = canvas(28, 11);
    t.rect(2, 4, 4, 6, '#');
    t.h(5, 5, 12, '+'); t.v(13, 2, 8, '+');
    for (const r of [2, 5, 8]) t.h(r, 14, 20, '+');
    t.rect(21, 1, 23, 3, '#'); t.rect(21, 4, 23, 6, '#'); t.rect(21, 7, 23, 9, 'r');
    t.h(8, 24, 26, 'r'); t.set(25, 8, '.'); // the helper, still sending after its parent exited
    return t.g;
  },
  hook() {
    const p = canvas(28, 11);
    p.h(5, 0, 3, '+');
    p.rect(4, 2, 10, 8, '#');
    p.h(4, 11, 15, '#'); p.h(6, 11, 15, '#');
    p.outline(17, 1, 25, 9, '+');
    p.set(18, 4, 'o'); p.set(18, 6, 'o');
    p.set(22, 5, 'r'); p.h(5, 23, 27, ' '); p.set(24, 5, 'r'); p.set(26, 5, 'r'); // a direct socket, reported as it opens
    return p.g;
  },
  radar() {
    const r = canvas(28, 11);
    const cx = 13.5, cy = 10.4;
    for (let j = 0; j < 11; j++) for (let i = 0; i < 28; i++) {
      const dx = i - cx, dy = j - cy, d = Math.hypot(dx, dy);
      if (d > 10.6) { r.set(i, j, ' '); continue; }
      if ([3.4, 6.6, 9.8].some((R) => Math.abs(d - R) < 0.5)) r.set(i, j, '+');
      const a = (Math.atan2(-dy, dx) * 180) / Math.PI;
      if (Math.abs(a - 62) < 5 && d < 9.9) r.set(i, j, '#');
    }
    r.set(18, 5, 'r'); r.set(19, 5, 'r'); r.set(7, 6, 'o'); r.set(10, 9, 'o');
    return r.g;
  },
  fields() {
    const f = canvas(28, 10);
    const rows = [[6, 10, '+'], [4, 7, '+'], [7, 12, 'r'], [5, 6, '+'], [6, 9, 'r'], [4, 11, '+'], [7, 5, '+'], [5, 8, '+']];
    rows.forEach(([k, v, ch], i) => { f.h(i + 1, 2, 1 + k, '#'); f.h(i + 1, 11, 10 + v, ch); });
    return f.g;
  },
  redact() {
    const d = canvas(28, 10);
    d.outline(1, 0, 26, 9, '+');
    d.h(2, 3, 9, '+'); d.h(2, 11, 16, '#'); d.h(2, 18, 23, '+');
    d.h(4, 3, 6, '+'); d.h(4, 8, 14, '#'); d.h(4, 16, 24, '+');
    d.h(6, 3, 10, '#'); d.h(6, 12, 21, '+');
    d.h(8, 3, 12, '+'); d.h(8, 14, 18, 'o'); d.h(8, 20, 23, '+');
    return d.g;
  },
};
function artSvg(name) {
  const g = ART[name]?.();
  if (!g) throw new Error(`no art "${name}"`);
  const S = 10, rows = g.length, cols = g[0].length;
  const dots = [];
  g.forEach((row, j) => row.forEach((ch, i) => {
    const x = i * S + S / 2, y = j * S + S / 2;
    if (ch === '.') dots.push(`<circle cx="${x}" cy="${y}" r="1.3" fill="#dbe6f6"/>`);
    else if (ch === '+') dots.push(`<circle cx="${x}" cy="${y}" r="3" fill="#86b6ef"/>`);
    else if (ch === '#') dots.push(`<circle cx="${x}" cy="${y}" r="3.2" fill="#2a78d6"/>`);
    else if (ch === 'o') dots.push(`<circle cx="${x}" cy="${y}" r="2.6" fill="none" stroke="#2a78d6" stroke-width="1.3"/>`);
    else if (ch === 'r') dots.push(`<circle cx="${x}" cy="${y}" r="3.2" fill="#d03b3b"/>`);
  }));
  return `<svg viewBox="0 0 ${cols * S} ${rows * S}" role="presentation" aria-hidden="true">${dots.join('')}</svg>`;
}

// ---------- partials, assets ----------
const nav = readFileSync(join(src, 'partials/nav.html'), 'utf8').replace('<!-- @logo -->', logo);
const footer = readFileSync(join(src, 'partials/footer.html'), 'utf8').replace('<!-- @logo -->', logo);
// Cache-bust the stylesheet and script: pages link them as /assets/x?v=<content hash>.
const version = (file) => createHash('sha256').update(readFileSync(join(src, file))).digest('hex').slice(0, 10);
const assets = { '/assets/site.css': version('assets/site.css'), '/assets/site.js': version('assets/site.js') };

// Pages whose Markdown twin is generated from the HTML. The home page's twin (site/index.md) is hand-written.
const GENERATED_MD = { '/docs/': 'docs.md', '/benchmark/': 'benchmark.md', '/faq/': 'faq.md' };
const MD_FOR = { '/': 'index.md', ...GENERATED_MD };

const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
td.use(gfm);
const hasClass = (node, c) => (node.getAttribute?.('class') ?? '').split(/\s+/).includes(c);
td.remove(['script', 'style', 'noscript', 'button', 'svg', 'aside', 'canvas']);
td.addRule('drop-ui', { filter: (n) => hasClass(n, 'tip') || hasClass(n, 'skip') || hasClass(n, 'art') || hasClass(n, 'table-view') || hasClass(n, 'seg'), replacement: () => '' });
td.addRule('pre', { filter: 'pre', replacement: (_c, n) => `\n\n\`\`\`\n${n.textContent.replace(/\n+$/, '')}\n\`\`\`\n\n` });
td.addRule('bars', {
  // Interactive charts become tables built from their data.
  filter: (n) => n.nodeName === 'DIV' && n.getAttribute('data-bars'),
  replacement: (_c, n) => {
    const d = JSON.parse(n.getAttribute('data-bars'));
    const sets = Object.keys(d.sets);
    const names = d.sets[sets[0]].map((r) => r.name);
    const lines = names.map((name) => `| ${name} | ${sets.map((s) => { const r = d.sets[s].find((x) => x.name === name); return `${r.label ?? `${r.value}%`} (${r.count})`; }).join(' | ')} |`);
    return `\n\n**Attempts ${d.metric}** (lower is better)\n\n| Tool | ${sets.join(' | ')} |\n|---|${sets.map(() => '---').join('|')}|\n${lines.join('\n')}\n\n`;
  },
});
td.addRule('stacks', {
  filter: (n) => n.nodeName === 'DIV' && n.getAttribute('data-stacks'),
  replacement: (_c, n) => {
    const d = JSON.parse(n.getAttribute('data-stacks'));
    const title = n.querySelector('h3')?.textContent ?? 'Outcomes';
    const lines = d.rows.map((r) => `| ${r.name} | ${r.parts.map((p) => `${p}%`).join(' | ')} | ${r.missedLabel ?? `${r.missed}%`} (${r.count}) |`);
    return `\n\n**${title}**\n\n| Tool | ${d.keys.join(' | ')} | silently missed |\n|---|${d.keys.map(() => '---').join('|')}|---|\n${lines.join('\n')}\n\n`;
  },
});
td.addRule('facts', {
  // Big-number tiles: "**3.4%**: of 594 attempts…"
  filter: (n) => n.nodeName === 'DIV' && hasClass(n, 'card') && n.querySelector?.('.num') && n.parentNode?.parentNode && hasClass(n.parentNode.parentNode, 'facts'),
  replacement: (_c, n) => `\n- **${n.querySelector('.num')?.textContent.trim()}**: ${n.querySelector('p')?.textContent.trim()}\n`,
});
td.addRule('absolute-links', {
  filter: (n) => n.nodeName === 'A' && n.getAttribute('href'),
  replacement: (content, n) => {
    let href = n.getAttribute('href');
    if (href.startsWith('/')) href = ORIGIN + href;
    else if (href.startsWith('#')) return content;
    return content.trim() ? `[${content}](${href})` : '';
  },
});

const textOf = (html) => html.replace(/<\/(p|div|h\d|li|pre)>/g, ' ').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const meta = (html, name) => html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`))?.[1] ?? '';

function toMarkdown(html, path) {
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] ?? '';
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'whatleaks';
  const body = td.turndown(main).replace(/\n{3,}/g, '\n\n').trim();
  return `---\ntitle: "${title.replace(/"/g, "'")}"\nurl: ${ORIGIN}${path}\nupdated: ${UPDATED}\n---\n\n> ${meta(html, 'description')}\n> Source: ${ORIGIN}${path} · Repository: ${REPO}\n\n${body}\n`;
}

function faqJsonLd(html) {
  const items = [...html.matchAll(/<section class="qa" id="([^"]+)">\s*<h2>([\s\S]*?)<\/h2>\s*<div class="a">([\s\S]*?)<\/div>\s*<\/section>/g)];
  if (!items.length) return '';
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    url: `${ORIGIN}/faq/`,
    mainEntity: items.map(([, id, q, a]) => ({
      '@type': 'Question',
      '@id': `${ORIGIN}/faq/#${id}`,
      name: textOf(q),
      acceptedAnswer: { '@type': 'Answer', text: textOf(a) },
    })),
  };
  return `<script type="application/ld+json">\n${JSON.stringify(data)}\n</script>\n`;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const markdown = {};

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const from = join(dir, name);
    const rel = relative(src, from);
    if (rel === 'partials' || name === '.DS_Store') continue;
    if (statSync(from).isDirectory()) { walk(from); continue; }
    const to = join(out, rel);
    mkdirSync(join(to, '..'), { recursive: true });
    if (!name.endsWith('.html')) { cpSync(from, to); continue; }
    // "/docs/index.html" -> "/docs/": mark that nav link as the current page.
    const path = '/' + rel.replace(/index\.html$/, '').replace(/\\/g, '/');
    const pageNav = path === '/' ? nav : nav.replace(`<a href="${path}">`, `<a href="${path}" aria-current="page">`);
    let html = readFileSync(from, 'utf8').replace('<!-- @nav -->', pageNav).replace('<!-- @footer -->', footer);
    html = html.replace(/<!-- @art (\w+) -->/g, (_m, art) => artSvg(art));
    for (const [asset, v] of Object.entries(assets)) html = html.replaceAll(`"${asset}"`, `"${asset}?v=${v}"`);
    const alt = [`<link rel="alternate" type="text/plain" title="llms.txt" href="/llms.txt">`];
    if (MD_FOR[path]) alt.unshift(`<link rel="alternate" type="text/markdown" title="This page as Markdown" href="/${MD_FOR[path]}">`);
    html = html.replace('<link rel="stylesheet"', `${alt.join('\n')}\n${faqJsonLd(html)}<link rel="stylesheet"`);
    if (html.includes('<!-- @')) throw new Error(`unfilled partial in ${rel}`);
    writeFileSync(to, html);
    if (GENERATED_MD[path]) markdown[GENERATED_MD[path]] = toMarkdown(html, path);
  }
}
walk(src);

for (const [file, md] of Object.entries(markdown)) writeFileSync(join(out, file), md);
markdown['index.md'] = readFileSync(join(src, 'index.md'), 'utf8');
const order = ['index.md', 'docs.md', 'benchmark.md', 'faq.md'];
const full = order.map((f) => `<!-- ${ORIGIN}/${f} -->\n\n${markdown[f].trim()}\n`).join('\n\n---\n\n');
writeFileSync(join(out, 'llms-full.txt'), `# whatleaks: everything on whatleaks.me, as Markdown (generated ${UPDATED})\n\n${full}`);
console.log(`built ${relative(root, out)}/ (+ ${Object.keys(GENERATED_MD).length} generated .md, llms-full.txt)`);
