// whatleaks.me: small, dependency-free page behaviour. Everything degrades to static content without JS,
// and nothing here talks to any server: this page makes no requests beyond its own files.
document.documentElement.classList.remove('no-js');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Copy buttons: <button data-copy="text"> or a .code block's button.
const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
const DONE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 12l5 5L20 6"/></svg>';
async function copy(text, btn, label) {
  try { await navigator.clipboard.writeText(text); } catch { return; }
  btn.dataset.done = '';
  // A button with an .ic slot keeps its text and swaps only the icon.
  const target = btn.querySelector('.ic') ?? btn;
  const prev = target.innerHTML;
  target.innerHTML = label ? 'Copied' : DONE_ICON;
  setTimeout(() => { delete btn.dataset.done; target.innerHTML = prev; }, 1600);
}
for (const btn of document.querySelectorAll('[data-copy]')) {
  const slot = btn.querySelector('.ic');
  if (slot) slot.innerHTML = COPY_ICON;
  else if (!btn.innerHTML.trim()) btn.innerHTML = COPY_ICON;
  btn.addEventListener('click', () => copy(btn.dataset.copy, btn));
}
for (const block of document.querySelectorAll('.code')) {
  const btn = document.createElement('button');
  btn.className = 'copy'; btn.type = 'button'; btn.textContent = 'Copy';
  btn.addEventListener('click', () => {
    const text = [...block.querySelector('pre').childNodes]
      .filter((n) => !(n.nodeType === 1 && (n.classList.contains('c') || n.classList.contains('p'))))
      .map((n) => n.textContent).join('')
      .split('\n').map((l) => l.replace(/\s+$/, '')).filter(Boolean).join('\n');
    copy(text, btn, true);
  });
  block.append(btn);
}

// Mobile menu, and a hairline under the nav once the page has scrolled.
const nav = document.querySelector('.nav');
nav?.querySelector('.menu-btn')?.addEventListener('click', (e) => {
  const open = nav.classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', String(open));
});
const onScroll = () => nav?.classList.toggle('scrolled', window.scrollY > 8);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Reveal on scroll.
const io = 'IntersectionObserver' in window && !reduced
  ? new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -6% 0px' })
  : null;
for (const el of document.querySelectorAll('.reveal')) {
  if (io) io.observe(el);
  else el.classList.add('in');
}

// Terminal tabs (ARIA tabs: arrow keys move between them).
for (const list of document.querySelectorAll('[role="tablist"]')) {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const select = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) tab.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); select(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });
}

// Hero field: diagonal bands of dots outside the text column, with packets running along them.
// Most packets are blue (seen); one in five is red (a leak). Static when motion is reduced.
const canvas = document.querySelector('canvas.field');
if (canvas && canvas.getContext) {
  const ctx = canvas.getContext('2d');
  const S = 14; // grid step, css px
  let cols = 0, rows = 0, cells = [], packets = [], w = 0, h = 0, raf = 0, last = 0, visible = true;
  const rand = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const bands = [
    { x0: -0.06, k: 0.55, width: 2.4 }, { x0: 0.02, k: 0.36, width: 1.6 },
    { x0: 1.06, k: -0.55, width: 2.4 }, { x0: 0.98, k: -0.36, width: 1.6 },
  ];
  function layout() {
    const r = canvas.getBoundingClientRect();
    w = r.width; h = r.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(w / S) + 1; rows = Math.ceil(h / S) + 1;
    const keep = Math.min(860, w * 0.7) / 2; // text column half-width kept clear
    cells = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = i * S, y = j * S;
        const clear = Math.abs(x - w / 2) < keep ? 1 - Math.min(1, (keep - Math.abs(x - w / 2)) / 120) : 1;
        if (clear <= 0) continue;
        let best = 0, bi = -1;
        bands.forEach((b, n) => {
          const cx = (b.x0 * w) + b.k * y; // band centre at this row
          const d = Math.abs(x - cx) / (b.width * 3 * S);
          const v = Math.max(0, 1 - d);
          if (v > best) { best = v; bi = n; }
        });
        if (best <= 0.05 || rand() > 0.35 + best * 0.6) continue;
        cells.push({ x, y, a: (0.12 + best * 0.7) * clear, hollow: rand() < 0.35, band: bi });
      }
    }
    packets = [];
  }
  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    for (const c of cells) {
      ctx.globalAlpha = c.a;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 2, 0, Math.PI * 2);
      if (c.hollow) { ctx.strokeStyle = '#93c5fd'; ctx.lineWidth = 1; ctx.stroke(); }
      else { ctx.fillStyle = '#93c5fd'; ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    if (reduced) return;
    // Spawn and move packets along the bands, one row at a time.
    if (t - last > 70) {
      last = t;
      if (packets.length < 14 && rand() < 0.5) {
        const b = Math.floor(rand() * bands.length);
        packets.push({ b, j: -2, off: (rand() - 0.5) * bands[b].width * 2.4, red: rand() < 0.2, trail: [] });
      }
      for (const p of packets) { p.trail.unshift(p.j); p.trail.length = Math.min(p.trail.length, 5); p.j += 1; }
      packets = packets.filter((p) => p.j < rows + 6);
    }
    for (const p of packets) {
      const b = bands[p.b];
      const at = (j) => {
        const y = j * S;
        const x = Math.round((b.x0 * w + b.k * y) / S + p.off) * S;
        return [x, y];
      };
      const keep = Math.min(860, w * 0.7) / 2;
      const col = p.red ? '220, 38, 38' : '37, 99, 235';
      [p.j, ...p.trail].forEach((j, n) => {
        const [x, y] = at(j);
        if (Math.abs(x - w / 2) < keep) return;
        ctx.fillStyle = `rgba(${col}, ${n === 0 ? 0.95 : 0.5 / n})`;
        ctx.beginPath();
        ctx.arc(x, y, n === 0 ? 2.8 : 2.2, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }
  function loop(t) { draw(t); if (!reduced && visible) raf = requestAnimationFrame(loop); }
  layout(); draw(0);
  let resizeTimer;
  addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { layout(); draw(0); }, 150); });
  if (!reduced) {
    new IntersectionObserver((e) => {
      visible = e[0].isIntersecting;
      cancelAnimationFrame(raf);
      if (visible) raf = requestAnimationFrame(loop);
    }).observe(canvas);
    document.addEventListener('visibilitychange', () => { cancelAnimationFrame(raf); if (!document.hidden && visible) raf = requestAnimationFrame(loop); });
  }
}

// Dot-matrix text: <canvas class="dottext" data-text="whatleaks." data-tone="dark|light" data-cols="150">.
// The text is drawn in Geist on a hidden canvas and sampled on a grid; a trailing "." is the red leak.
function drawDots(cv) {
  const text = cv.dataset.text ?? '';
  const dark = cv.dataset.tone === 'dark';
  const w = cv.clientWidth;
  if (!w || !text) return;
  const off = document.createElement('canvas');
  const o = off.getContext('2d', { willReadFrequently: true });
  const face = cv.dataset.font === 'mono' ? "'Geist Mono', ui-monospace, monospace" : 'Geist, ui-sans-serif, sans-serif';
  const weight = cv.dataset.weight || '500';
  o.font = `${weight} 100px ${face}`;
  const scale = (w * 0.98) / o.measureText(text).width;
  const size = 100 * scale;
  const h = Math.ceil(size * 0.86);
  off.width = w; off.height = h;
  o.font = `${weight} ${size}px ${face}`;
  o.textBaseline = 'alphabetic';
  const tw = o.measureText(text).width;
  const x0 = (w - tw) / 2;
  o.fillText(text, x0, h * 0.8);
  const leakX = text.endsWith('.') ? x0 + o.measureText(text.slice(0, -1)).width : Infinity;
  const img = o.getImageData(0, 0, w, h).data;
  const step = Math.max(4, w / Number(cv.dataset.cols || 120));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.style.height = `${h}px`;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const r = step * 0.33;
  for (let y = step / 2; y < h; y += step) {
    for (let x = step / 2; x < w; x += step) {
      const inside = img[(Math.floor(y) * w + Math.floor(x)) * 4 + 3] > 120;
      ctx.beginPath();
      ctx.arc(x, y, inside ? r : r * 0.55, 0, Math.PI * 2);
      if (!inside) { ctx.fillStyle = dark ? 'rgba(255,255,255,0.05)' : '#e8f0fe'; ctx.fill(); continue; }
      if (x >= leakX) { ctx.fillStyle = '#ef4444'; ctx.fill(); continue; }
      const hollow = rand() < 0.14;
      const col = dark ? (rand() < 0.1 ? '#93c5fd' : '#f5f5f5') : (rand() < 0.15 ? '#93c5fd' : '#2563eb');
      if (hollow) { ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, r * 0.35); ctx.stroke(); } else { ctx.fillStyle = col; ctx.fill(); }
    }
  }
}
const dotCanvases = [...document.querySelectorAll('canvas.dottext')];
if (dotCanvases.length) {
  const drawAll = () => dotCanvases.forEach(drawDots);
  Promise.all([document.fonts?.load('500 100px Geist'), document.fonts?.load('800 100px Geist'), document.fonts?.load("500 100px 'Geist Mono'")]).then(drawAll, drawAll);
  let t;
  addEventListener('resize', () => { clearTimeout(t); t = setTimeout(drawAll, 150); });
}

// Tooltip helper: values lead, labels follow; text only (textContent), never innerHTML.
function tooltip(host) {
  const tip = document.createElement('div');
  tip.className = 'tip'; tip.setAttribute('role', 'status');
  host.append(tip);
  return {
    show(lines, x, y) {
      tip.replaceChildren();
      const v = document.createElement('div'); v.className = 'v'; v.textContent = lines.value; tip.append(v);
      const k = document.createElement('div'); k.className = 'k';
      const key = document.createElement('i'); if (lines.key) key.className = lines.key; key.style.background = lines.color || '';
      const name = document.createElement('span'); name.textContent = lines.label;
      k.append(key, name); tip.append(k);
      if (lines.sub) { const s = document.createElement('div'); s.className = 's'; s.textContent = lines.sub; tip.append(s); }
      const maxX = host.clientWidth - tip.offsetWidth - 4;
      tip.style.left = Math.max(4, Math.min(x + 14, maxX)) + 'px';
      tip.style.top = y + 14 + 'px';
      tip.style.opacity = 1;
    },
    hide() { tip.style.opacity = 0; },
  };
}
const fmt = (v) => `${v}%`;

// Emphasis bars: <div class="viz" data-bars='{"metric", "sets": {"macOS": [{name, value, count, hl}]}}'>.
for (const viz of document.querySelectorAll('.viz[data-bars]')) {
  const data = JSON.parse(viz.dataset.bars);
  const host = viz.querySelector('.bars');
  const tip = tooltip(viz);
  const ticks = [0, 25, 50, 75, 100];
  const grid = document.createElement('div'); grid.className = 'grid-lines'; grid.setAttribute('aria-hidden', 'true');
  for (const t of ticks) { const i = document.createElement('i'); i.style.left = `${t}%`; grid.append(i); }
  const list = document.createElement('div'); list.setAttribute('role', 'list');
  const axis = document.createElement('div'); axis.className = 'axis'; axis.setAttribute('aria-hidden', 'true');
  const tickBox = document.createElement('div'); tickBox.className = 'ticks';
  for (const t of ticks) { const s = document.createElement('span'); s.style.left = `${t}%`; s.textContent = `${t}%`; tickBox.append(s); }
  axis.append(document.createElement('span'), tickBox, document.createElement('span'));
  host.append(grid, list, axis);
  const render = (set) => {
    const rows = data.sets[set];
    list.replaceChildren();
    for (const d of rows) {
      const row = document.createElement('div');
      row.className = 'row' + (d.hl ? ' hl' : '');
      row.tabIndex = 0; row.setAttribute('role', 'listitem');
      const label = d.label ?? fmt(d.value);
      row.setAttribute('aria-label', `${d.name}: ${label} ${data.metric} on ${set} (${d.count} attempts)`);
      const name = document.createElement('span'); name.className = 'name'; name.textContent = d.name;
      const track = document.createElement('span'); track.className = 'track';
      const fill = document.createElement('span'); fill.className = 'fill';
      // The value rides at the bar's tip.
      const val = document.createElement('span'); val.className = 'val'; val.textContent = label;
      track.append(fill, val);
      row.append(name, track, document.createElement('span'));
      const lines = { value: label, label: `${d.name} · ${data.metric}`, sub: `${d.count} attempts on ${set}`, key: d.hl ? 'blue' : '' };
      row.addEventListener('pointermove', (e) => { const r = viz.getBoundingClientRect(); tip.show(lines, e.clientX - r.left, e.clientY - r.top); });
      row.addEventListener('pointerleave', () => tip.hide());
      row.addEventListener('focus', () => tip.show(lines, row.offsetLeft + 140, row.offsetTop + row.offsetHeight + host.offsetTop - 8));
      row.addEventListener('blur', () => tip.hide());
      list.append(row);
      requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${d.value}%`; val.style.left = `${d.value}%`; }));
    }
  };
  const seg = viz.querySelector('.seg');
  const start = () => render(Object.keys(data.sets)[0]);
  seg?.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    for (const x of seg.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
    render(b.dataset.set);
  });
  if (reduced || !('IntersectionObserver' in window)) start();
  else { const o = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { o.disconnect(); start(); } }, { threshold: 0.25 }); o.observe(viz); }
}

// Stacked outcome bars: <div class="viz" data-stacks='{"keys": [...], "rows": [{name, parts: [..], missed, count, hl}]}'>.
for (const viz of document.querySelectorAll('.viz[data-stacks]')) {
  const data = JSON.parse(viz.dataset.stacks);
  const host = viz.querySelector('.stacks');
  const tip = tooltip(viz);
  const colors = ['#1e3a8a', '#2563eb', '#6ea8f7'];
  for (const d of data.rows) {
    const row = document.createElement('div'); row.className = 'row' + (d.hl ? ' hl' : '');
    const name = document.createElement('span'); name.className = 'name'; name.textContent = d.name;
    const bar = document.createElement('div'); bar.className = 'bar'; bar.setAttribute('role', 'list');
    const total = d.parts.reduce((a, b) => a + b, 0) + d.missed;
    d.parts.forEach((p, i) => {
      if (!p) return;
      const s = document.createElement('span'); s.className = 'seg-o'; s.tabIndex = 0; s.setAttribute('role', 'listitem');
      s.style.width = `${(p / total) * 100}%`; s.style.background = colors[i];
      s.setAttribute('aria-label', `${d.name}: ${fmt(p)} ${data.keys[i]}`);
      const lines = { value: fmt(p), label: data.keys[i], sub: d.name, color: colors[i] };
      s.addEventListener('pointermove', (e) => { const r = viz.getBoundingClientRect(); tip.show(lines, e.clientX - r.left, e.clientY - r.top); });
      s.addEventListener('pointerleave', () => tip.hide());
      s.addEventListener('focus', () => { const r = viz.getBoundingClientRect(), b = s.getBoundingClientRect(); tip.show(lines, b.left - r.left, b.bottom - r.top); });
      s.addEventListener('blur', () => tip.hide());
      bar.append(s);
    });
    // The remainder is what nothing in the tool's output points to.
    const m = document.createElement('span'); m.className = 'seg-o missed'; m.tabIndex = 0; m.setAttribute('role', 'listitem');
    m.style.width = `${(d.missed / total) * 100}%`;
    const missed = d.missedLabel ?? fmt(d.missed);
    m.setAttribute('aria-label', `${d.name}: ${missed} silently missed (${d.count})`);
    const ml = { value: missed, label: 'silently missed', sub: `${d.name} · ${d.count}`, color: '#dcdbd6' };
    m.addEventListener('pointermove', (e) => { const r = viz.getBoundingClientRect(); tip.show(ml, e.clientX - r.left, e.clientY - r.top); });
    m.addEventListener('pointerleave', () => tip.hide());
    m.addEventListener('focus', () => { const r = viz.getBoundingClientRect(), b = m.getBoundingClientRect(); tip.show(ml, b.left - r.left, b.bottom - r.top); });
    m.addEventListener('blur', () => tip.hide());
    bar.append(m);
    const val = document.createElement('span'); val.className = 'val';
    val.textContent = `${missed} missed`;
    const small = document.createElement('small'); small.textContent = d.count; val.append(small);
    row.append(name, bar, val);
    host.append(row);
  }
}

// Docs table of contents: highlight the section in view.
const tocLinks = [...document.querySelectorAll('.toc a[href^="#"]')];
if (tocLinks.length && 'IntersectionObserver' in window) {
  const byId = new Map(tocLinks.map((a) => [a.getAttribute('href').slice(1), a]));
  const tio = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) {
      for (const a of tocLinks) a.classList.toggle('active', a === byId.get(e.target.id));
    }
  }, { rootMargin: '-20% 0px -70% 0px' });
  for (const id of byId.keys()) { const s = document.getElementById(id); if (s) tio.observe(s); }
}
