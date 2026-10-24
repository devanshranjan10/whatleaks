// Builds whatleaks.me: copies site/ to .site-dist/, filling in the shared nav and footer partials, the logo, the
// dot-matrix illustrations and each page's structured data (JSON-LD), and writes the agent-readable copies: /<page>.md
// for every page, /llms-full.txt and a dated sitemap. Links that leave the site open in a new tab.
// Usage: node scripts/site/build.mjs
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const ORIGIN = 'https://whatleaks.me';
const REPO = 'https://github.com/devanshranjan10/whatleaks';
// Today in the author's time zone, as in CHANGELOG.md and CITATION.cff (UTC's date can be a day behind).
const now = new Date();
const UPDATED = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
const UPDATED_LONG = new Date(`${UPDATED}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const root = fileURLToPath(new URL('../../', import.meta.url));
const src = join(root, 'site');
const out = join(root, '.site-dist');
const VERSION = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

// ---------- logo: a droplet of dots, the last one red (what leaks) ----------
const DROP = [[12, 3], [12, 6], [9, 9], [12, 9], [15, 9], [6, 12], [9, 12], [12, 12], [15, 12], [18, 12], [6, 15], [9, 15], [12, 15], [15, 15], [18, 15], [6, 18], [9, 18], [12, 18], [15, 18], [18, 18], [9, 21], [15, 21], [12, 21]];
const logo = `<svg viewBox="1 1 22 22" aria-hidden="true">${DROP.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="1.35" fill="${i === DROP.length - 1 ? '#dc2626' : '#2563eb'}"/>`).join('')}</svg>`;

// ---------- dot-matrix illustrations ----------
// A 32 x 18 grid (16:9, so it fills its card). Characters: '#' solid dot, '+' light dot, 'o' hollow dot,
// 'r' red dot (what leaks), '.' empty (the card's own dotted background shows through).
const COLS = 32, ROWS = 18;
function canvas() {
  const g = Array.from({ length: ROWS }, () => Array(COLS).fill('.'));
  const set = (c, r, ch) => { if (r >= 0 && r < ROWS && c >= 0 && c < COLS) g[r][c] = ch; };
  return {
    g, set,
    rect(c0, r0, c1, r1, ch) { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) set(c, r, ch); },
    outline(c0, r0, c1, r1, ch) { for (let c = c0; c <= c1; c++) { set(c, r0, ch); set(c, r1, ch); } for (let r = r0; r <= r1; r++) { set(c0, r, ch); set(c1, r, ch); } },
    h(r, c0, c1, ch) { for (let c = c0; c <= c1; c++) set(c, r, ch); },
    v(c, r0, r1, ch) { for (let r = r0; r <= r1; r++) set(c, r, ch); },
    ring(cx, cy, R, ch, keep = () => true, width = 0.55) {
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (Math.abs(Math.hypot(c - cx, r - cy) - R) < width && keep(c, r)) set(c, r, ch);
    },
  };
}
const ART = {
  // 01 a padlock: the run's own CA
  lock() {
    const k = canvas();
    k.ring(15.5, 7.2, 4.6, '#', (c, r) => r <= 7);
    k.v(11, 7, 8, '#'); k.v(20, 7, 8, '#');
    k.rect(9, 8, 22, 15, '#');
    for (const [c, r] of [[9, 8], [22, 8], [9, 15], [22, 15]]) k.set(c, r, '.');
    k.rect(15, 10, 16, 11, '.'); k.rect(15, 12, 16, 13, '.');
    for (const [c, r] of [[4, 3], [27, 4], [5, 12], [26, 13], [28, 9]]) k.set(c, r, '+');
    k.set(3, 7, 'o'); k.set(29, 15, 'o');
    return k.g;
  },
  // 02 the process tree, one helper still sending after its parent exited
  tree() {
    const t = canvas();
    t.rect(2, 7, 5, 10, '#');
    t.h(8, 6, 10, '+'); t.h(9, 6, 10, '+');
    t.v(11, 3, 14, '+');
    for (const r of [3, 8, 14]) t.h(r, 12, 16, '+');
    t.h(9, 12, 16, '+');
    t.rect(17, 2, 20, 4, '#'); t.rect(17, 7, 20, 10, '#'); t.rect(17, 13, 20, 15, 'r');
    for (const c of [23, 25, 27, 29]) t.set(c, 14, 'r');
    t.set(24, 3, 'o'); t.set(26, 8, '+');
    return t.g;
  },
  // 03 a plug in its socket: a hook inside the runtime; one direct socket reported on its way out
  plug() {
    const p = canvas();
    p.h(9, 0, 3, '+');
    p.rect(4, 5, 10, 13, '#');
    for (const [c, r] of [[4, 5], [10, 5], [4, 13], [10, 13]]) p.set(c, r, '.');
    p.h(7, 11, 14, '#'); p.h(11, 11, 14, '#');
    p.outline(16, 3, 24, 15, '+');
    p.set(17, 7, 'o'); p.set(17, 11, 'o');
    p.set(24, 9, '.');
    for (const c of [26, 28, 30]) p.set(c, 9, 'r');
    return p.g;
  },
  // 04 a radar sweep: connections that go around the proxy are still named
  radar() {
    const r = canvas();
    const cx = 15.5, cy = 17.2;
    for (const R of [5, 9.6, 14.2]) r.ring(cx, cy, R, '+', (c, y) => y <= 17);
    for (let y = 0; y < ROWS; y++) for (let c = 0; c < COLS; c++) {
      const d = Math.hypot(c - cx, y - cy), a = (Math.atan2(cy - y, c - cx) * 180) / Math.PI;
      if (Math.abs(a - 58) < 4.5 && d < 14.6 && d > 1) r.set(c, y, '#');
    }
    r.set(23, 12, 'r'); r.set(24, 12, 'r'); r.set(23, 11, 'r');
    r.set(5, 8, 'o'); r.set(13, 12, 'o');
    return r.g;
  },
  // 05 every field inventoried; two of them are identifiers
  fields() {
    const f = canvas();
    const rows = [[5, 11, '+'], [3, 7, '+'], [6, 13, 'r'], [4, 6, '+'], [5, 9, 'r'], [3, 12, '+'], [6, 5, '+']];
    rows.forEach(([k, v, ch], i) => { const y = 3 + i * 2; f.h(y, 3, 2 + k, '#'); f.h(y, 13, 12 + v, ch); });
    f.v(11, 2, 16, 'o');
    return f.g;
  },
  // 06 a report with its secrets blacked out and ids aliased
  redact() {
    const d = canvas();
    d.outline(4, 1, 27, 16, '+');
    d.h(4, 7, 11, '+'); d.h(4, 13, 18, '#'); d.h(4, 20, 24, '+');
    d.h(7, 7, 9, '+'); d.h(7, 11, 16, '#'); d.h(7, 18, 24, '+');
    d.h(10, 7, 13, '#'); d.h(10, 15, 23, '+');
    d.h(13, 7, 14, '+'); d.h(13, 16, 19, 'o'); d.h(13, 21, 24, '+');
    return d.g;
  },
  // a speech bubble with a question mark; its dot is the red one
  ask() {
    const q = canvas();
    q.outline(3, 1, 28, 13, '+');
    for (const [c, r] of [[3, 1], [28, 1], [3, 13], [28, 13]]) q.set(c, r, '.');
    q.set(7, 14, '+'); q.set(6, 15, '+'); q.set(5, 16, '+'); q.set(8, 14, '+');
    q.h(3, 14, 17, '#'); q.set(13, 4, '#'); q.set(18, 4, '#'); q.set(13, 5, '#'); q.set(18, 5, '#');
    q.set(17, 6, '#'); q.set(16, 7, '#'); q.set(15, 8, '#'); q.set(16, 8, '#'); q.set(15, 9, '#'); q.set(16, 9, '#');
    q.set(15, 11, 'r'); q.set(16, 11, 'r');
    q.h(5, 6, 9, '+'); q.h(7, 6, 8, '+'); q.h(5, 22, 25, '+'); q.h(9, 22, 24, '+');
    return q.g;
  },
  // a HAR file under a magnifier, with an identifier found
  har() {
    const h = canvas();
    h.outline(5, 1, 18, 16, '+');
    for (const [c, r] of [[16, 1], [17, 1], [18, 1], [17, 2], [18, 2], [18, 3]]) h.set(c, r, '.');
    h.set(16, 2, '+'); h.set(17, 3, '+'); h.set(16, 3, '+');
    h.h(4, 8, 10, '#'); h.h(6, 9, 15, '+'); h.h(8, 9, 13, '+'); h.h(10, 9, 14, '+'); h.h(12, 8, 10, '#');
    h.ring(22.5, 10.5, 3.8, '#');
    for (const [c, r] of [[25, 14], [26, 15], [27, 16], [28, 17]]) h.set(c, r, '#');
    h.set(22, 10, 'r'); h.set(23, 10, 'r'); h.set(22, 11, 'r'); h.set(23, 11, 'r');
    return h.g;
  },
};
// On the page each illustration is a <canvas data-grid="row|row|…">, drawn and animated by assets/site.js.
function artGrid(name) {
  const g = ART[name]?.();
  if (!g) throw new Error(`no art "${name}"`);
  return `<canvas data-grid="${g.map((row) => row.join('')).join('|')}" aria-hidden="true"></canvas>`;
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

const PERSON = { '@type': 'Person', name: 'Devansh Ranjan', url: 'https://github.com/devanshranjan10' };
const SOFTWARE_ID = `${ORIGIN}/#software`;
const crumbs = (name, path) => ({
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'whatleaks', item: `${ORIGIN}/` },
    { '@type': 'ListItem', position: 2, name, item: `${ORIGIN}${path}` },
  ],
});
const article = (html, path, extra = {}) => ({
  '@type': 'TechArticle',
  '@id': `${ORIGIN}${path}#article`,
  headline: html.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'whatleaks',
  description: meta(html, 'description'),
  url: `${ORIGIN}${path}`,
  inLanguage: 'en',
  datePublished: '2026-10-23',
  dateModified: UPDATED,
  author: PERSON,
  publisher: PERSON,
  about: { '@id': SOFTWARE_ID },
  ...extra,
});
// Schema.org data for each page: what the software is, what each page is, and the benchmark as a dataset.
function pageJsonLd(html, path) {
  const graph = [];
  if (path === '/') {
    graph.push({
      '@type': 'SoftwareApplication',
      '@id': SOFTWARE_ID,
      name: 'whatleaks',
      applicationCategory: 'DeveloperApplication',
      applicationSubCategory: 'Network monitoring and privacy',
      operatingSystem: 'macOS, Linux',
      softwareVersion: VERSION,
      softwareRequirements: 'Node.js 22.12 or later',
      datePublished: '2026-10-23',
      dateModified: UPDATED,
      license: 'https://opensource.org/licenses/MIT',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      url: `${ORIGIN}/`,
      downloadUrl: 'https://www.npmjs.com/package/whatleaks',
      installUrl: 'https://www.npmjs.com/package/whatleaks',
      codeRepository: REPO,
      author: PERSON,
      sameAs: [REPO, 'https://www.npmjs.com/package/whatleaks', 'https://github.com/devanshranjan10/homebrew-tap'],
      description: 'Runs a command through a local, single-run proxy and reports where its traffic went, which fields each payload carried, whether any of it identifies the machine or user, and what is still sent after opting out of telemetry.',
      featureList: [
        'Captures every request a command sends, through a local proxy with a certificate authority made for that run',
        'Tests telemetry opt-outs: runs the command twice, defaults then opted out, and diffs what was sent',
        "Searches payloads for the user's identifiers (username, hostname, home path, MAC address, machine id, git email), raw and hashed",
        'Follows the whole process tree, including helpers that send after the app exits',
        'Writes redacted reports for sharing, and reads HAR files from other tools',
      ],
      screenshot: `${ORIGIN}/media/whatleaks-demo-poster.png`,
      video: {
        '@type': 'VideoObject',
        name: 'whatleaks demo: what next build sends, with and without DO_NOT_TRACK=1',
        description: 'Real output of whatleaks 0.1.0 on next build (Next.js 16.4.2), replayed: with DO_NOT_TRACK=1 telemetry went 8 → 8 requests; with NEXT_TELEMETRY_DISABLED=1, 8 → 0.',
        thumbnailUrl: `${ORIGIN}/media/whatleaks-demo-poster.png`,
        contentUrl: `${ORIGIN}/media/whatleaks-demo.mp4`,
        uploadDate: '2026-10-24',
        duration: 'PT55S',
      },
    });
    graph.push({ '@type': 'WebSite', '@id': `${ORIGIN}/#website`, name: 'whatleaks', url: `${ORIGIN}/`, inLanguage: 'en', publisher: PERSON, about: { '@id': SOFTWARE_ID } });
  } else if (path === '/docs/') {
    graph.push(article(html, path), crumbs('Docs', path));
  } else if (path === '/benchmark/') {
    graph.push(article(html, path, { datePublished: '2026-10-22' }), crumbs('Benchmark', path), {
      '@type': 'Dataset',
      '@id': `${ORIGIN}/benchmark/#dataset`,
      name: 'whatleaks benchmark: lab scenarios with exact ground truth, and real tools',
      description: 'How often HTTP(S) capture tools silently miss what a program sends. 46 lab scenarios and 594 attempts on macOS, 43 and 567 on Linux, each attempt written to a ledger before it is made; plus five real-tool runs (Next.js, Turborepo, Astro, Wrangler) checked against each tool\'s own debug output. Tools: whatleaks, mitmproxy 12.2.3, HTTP Toolkit server 1.27.3 and phonehome.',
      url: `${ORIGIN}/benchmark/`,
      sameAs: `${REPO}/blob/main/docs/BENCHMARK.md`,
      creator: PERSON,
      license: 'https://opensource.org/licenses/MIT',
      isAccessibleForFree: true,
      datePublished: '2026-10-22',
      dateModified: UPDATED,
      keywords: ['telemetry', 'network capture', 'HTTPS proxy', 'benchmark', 'mitmproxy', 'HTTP Toolkit', 'DO_NOT_TRACK', 'privacy'],
      variableMeasured: ['share of attempts silently missed', 'share of attempts whose payload was read', 'false attributions', 'planted identifiers found'],
      measurementTechnique: 'Each lab client writes every attempt to a ledger before making it; each tool\'s output is then scored attempt by attempt against the ledger.',
      distribution: [{ '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${REPO}/tree/main/bench/results` }],
    });
  } else if (path === '/faq/') {
    graph.push(crumbs('FAQ', path));
  }
  return graph.length ? `<script type="application/ld+json">\n${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}\n</script>\n` : '';
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
    if (/\.(txt|md|xml)$/.test(name)) { writeFileSync(to, readFileSync(from, 'utf8').replaceAll('__VERSION__', VERSION).replaceAll('__UPDATED__', UPDATED)); continue; }
    if (!name.endsWith('.html')) { cpSync(from, to); continue; }
    // "/docs/index.html" -> "/docs/": mark that nav link as the current page.
    const path = '/' + rel.replace(/index\.html$/, '').replace(/\\/g, '/');
    const pageNav = path === '/' ? nav : nav.replace(`<a href="${path}">`, `<a href="${path}" aria-current="page">`);
    let html = readFileSync(from, 'utf8').replace('<!-- @nav -->', pageNav).replace('<!-- @footer -->', footer);
    html = html.replace(/<!-- @grid (\w+) -->/g, (_m, art) => artGrid(art)).replace(/<!-- @jsonld \w+ -->\n?/, '');
    html = html.replace('<!-- @updated -->', `<time datetime="${UPDATED}">${UPDATED_LONG}</time>`).replaceAll('__VERSION__', VERSION);
    for (const [asset, v] of Object.entries(assets)) html = html.replaceAll(`"${asset}"`, `"${asset}?v=${v}"`);
    const alt = [`<link rel="alternate" type="text/plain" title="llms.txt" href="/llms.txt">`];
    if (MD_FOR[path]) alt.unshift(`<link rel="alternate" type="text/markdown" title="This page as Markdown" href="/${MD_FOR[path]}">`);
    html = html.replace('<link rel="stylesheet"', `${alt.join('\n')}\n${pageJsonLd(html, path)}${faqJsonLd(html)}<link rel="stylesheet"`);
    if (html.includes('<!-- @')) throw new Error(`unfilled partial in ${rel}`);
    // Links that leave whatleaks.me (GitHub, npm, sources…) open in a new tab.
    html = html.replace(/<a ([^>]*?)href="(https?:\/\/(?!whatleaks\.me)[^"]+)"([^>]*)>/g, (tag, before, href, after) =>
      /\btarget=/.test(tag) ? tag : `<a ${before}href="${href}" target="_blank" rel="noopener"${after}>`,
    );
    writeFileSync(to, html);
    if (GENERATED_MD[path]) markdown[GENERATED_MD[path]] = toMarkdown(html, path);
  }
}
walk(src);

for (const [file, md] of Object.entries(markdown)) writeFileSync(join(out, file), md);
markdown['index.md'] = readFileSync(join(src, 'index.md'), 'utf8').replaceAll('__VERSION__', VERSION).replaceAll('__UPDATED__', UPDATED);
const order = ['index.md', 'docs.md', 'benchmark.md', 'faq.md'];
const full = order.map((f) => `<!-- ${ORIGIN}/${f} -->\n\n${markdown[f].trim()}\n`).join('\n\n---\n\n');
writeFileSync(join(out, 'llms-full.txt'), `# whatleaks: everything on whatleaks.me, as Markdown (generated ${UPDATED})\n\n${full}`);
// The sitemap, dated by this build.
const PAGES = [['/', '1.0'], ['/docs/', '0.8'], ['/benchmark/', '0.8'], ['/faq/', '0.7']];
writeFileSync(join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PAGES.map(([path, priority]) => `  <url><loc>${ORIGIN}${path}</loc><lastmod>${UPDATED}</lastmod><priority>${priority}</priority></url>`).join('\n')}
</urlset>
`);
console.log(`built ${relative(root, out)}/ (+ ${Object.keys(GENERATED_MD).length} generated .md, llms-full.txt, sitemap.xml)`);
