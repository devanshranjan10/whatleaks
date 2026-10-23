// whatleaks.me: small, dependency-free page behaviour. Everything degrades to static content without JS, and nothing
// here talks to any server: the page makes no requests beyond its own files.
// The visuals are a dot-matrix field drawn on <canvas>: hollow and filled dots, a few of which leak (turn red and send
// out a ring), and dots that gather round the cursor. The same engine as landmine.tech, in whatleaks blue and red.
document.documentElement.classList.remove('no-js');
document.documentElement.classList.add('js');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const css = getComputedStyle(document.documentElement);
const ACCENT = css.getPropertyValue('--accent').trim() || '#2563eb';
const DOT = css.getPropertyValue('--dot').trim() || '#bcd1fa';
const DOT2 = css.getPropertyValue('--dot-2').trim() || '#dfe9fd';
const LEAK = css.getPropertyValue('--leak').trim() || '#e5484d';
const INK = '#09090b';
const MUTED = '#71717a';
const FAINT = '#a1a1aa';

/* ---------------------------------------------------------------- canvas helpers */

/** Size a canvas to its box at device resolution; returns the 2D context in CSS pixels. */
function fit(canvas) {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(r.width));
  const h = Math.max(1, Math.round(r.height));
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function dot(ctx, x, y, r, fill, ring) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
  if (ring) {
    ctx.lineWidth = Math.max(1, r * 0.42);
    ctx.strokeStyle = ring;
    ctx.stroke();
  } else {
    ctx.fillStyle = fill;
    ctx.fill();
  }
}

/** Run `frame(t)` only while the element is on screen and the tab is visible; once if motion is reduced. */
function animate(el, frame, fps = 30) {
  if (reduced) { frame(0); return; }
  let on = false;
  let raf = 0;
  let last = 0;
  const t0 = performance.now();
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (now - last < 1000 / fps) return;
    last = now;
    frame((now - t0) / 1000);
  };
  const set = (v) => {
    if (v === on) return;
    on = v;
    if (on && !document.hidden) raf = requestAnimationFrame(loop);
    else cancelAnimationFrame(raf);
  };
  if ('IntersectionObserver' in window) new IntersectionObserver((es) => set(es.some((e) => e.isIntersecting))).observe(el);
  else set(true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAnimationFrame(raf); else if (on) raf = requestAnimationFrame(loop); });
  frame(0);
}

// Smooth value noise, so dot clusters drift as soft diagonal streaks.
function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

/* ---------------------------------------------------------------- the field behind the hero and the headers */

/**
 * <canvas class="dots" data-field="hero|edge|soft|night">. Dots appear where drifting noise is high and fade where
 * the copy sits; the cursor sweeps a clearing that reveals more of them; now and then a dot leaks: it turns red and
 * sends out a ring.
 */
function leakfield(canvas) {
  const kind = canvas.dataset.field || 'hero';
  const host = canvas.parentElement;
  const night = kind === 'night';
  let mouse = null;
  const pings = [];
  let nextPing = 0.6;
  if (!coarse) {
    host.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; });
    host.addEventListener('pointerleave', () => { mouse = null; });
  }
  const filled = night ? 'rgba(255,255,255,.16)' : DOT;
  const faint = night ? 'rgba(255,255,255,.07)' : DOT2;
  const strong = night ? 'rgba(122,167,247,.9)' : ACCENT;
  animate(host, (t) => {
    const { ctx, w, h } = fit(canvas);
    ctx.clearRect(0, 0, w, h);
    const s = w < 640 ? 22 : 26;
    const r = s * 0.19;
    const cols = Math.ceil(w / s) + 1, rows = Math.ceil(h / s) + 1;
    const ox = (w - (cols - 1) * s) / 2, oy = 6;
    const visible = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = ox + i * s, y = oy + j * s;
        // Where the copy is, fewer dots: the hero keeps a calm centre column, other fields thin out evenly.
        const nx = Math.abs(x / w - 0.5) * 2;
        let mask;
        if (kind === 'hero') mask = (w < 640 ? smooth(0.6, 1.0, nx) : smooth(0.34, 0.86, nx)) * (1 - smooth(0.92, 1.0, y / h) * 0.6);
        else if (kind === 'edge' || kind === 'night') mask = smooth(w < 640 ? 0.7 : 0.66, 1.0, nx);
        else mask = 0.75;
        let v = noise(i * 0.16 + t * 0.12, j * 0.16 - i * 0.05 - t * 0.09) * mask;
        if (mouse) {
          const d = Math.hypot(mouse.x - x, mouse.y - y);
          if (d < 150) v += (1 - d / 150) * 0.55;
        }
        if (v < 0.4) continue;
        const tw = hash(i, j);
        const flick = Math.sin(t * (0.6 + tw * 1.4) + tw * 40) * 0.08;
        const val = v + flick;
        if (val > 0.66) dot(ctx, x, y, r, tw > 0.82 ? strong : filled);
        else if (val > 0.5) dot(ctx, x, y, r * 0.92, null, night ? 'rgba(255,255,255,.2)' : DOT);
        else dot(ctx, x, y, r * 0.8, faint);
        if (val > 0.5) visible.push([x, y]);
      }
    }
    // Leaks: a dot turns red and sends out a ring.
    if (!reduced && t > nextPing && visible.length) {
      const [x, y] = visible[Math.floor(Math.random() * visible.length)];
      pings.push({ x, y, t0: t });
      nextPing = t + 0.7 + Math.random() * 1.4;
    }
    for (let k = pings.length - 1; k >= 0; k--) {
      const p = pings[k];
      const a = (t - p.t0) / 1.6;
      if (a > 1) { pings.splice(k, 1); continue; }
      dot(ctx, p.x, p.y, r * 1.15, LEAK);
      ctx.globalAlpha = 1 - a;
      dot(ctx, p.x, p.y, r + a * s * 1.6, null, LEAK);
      ctx.globalAlpha = 1;
    }
  });
}

/* ---------------------------------------------------------------- dot text (the footer's wordmark, the FAQ panel) */

/** Rasterise `text` and sample it on a grid: one dot per cell, filled where the glyph is solid, hollow at its edges. */
function textCells(text, cols, font = '700 100px "Rethink Sans", system-ui, sans-serif') {
  const k = 6;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const m = probe.measureText(text);
  const aspect = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / m.width;
  const rows = Math.max(3, Math.round(cols * aspect));
  const c = document.createElement('canvas');
  c.width = cols * k;
  c.height = rows * k;
  const g = c.getContext('2d', { willReadFrequently: true });
  const scale = (cols * k) / m.width;
  g.scale(scale, scale);
  g.font = font;
  g.fillStyle = '#000';
  g.fillText(text, -m.actualBoundingBoxLeft, m.actualBoundingBoxAscent);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  const cells = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      let sum = 0;
      for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) sum += data[((j * k + y) * c.width + i * k + x) * 4 + 3];
      const cov = sum / (k * k * 255);
      if (cov > 0.12) cells.push({ i, j, cov });
    }
  }
  // The column where the last character starts: whatleaks's full stop is the red dot.
  const lastAt = Math.floor((probe.measureText(text.slice(0, -1)).width / m.width) * cols);
  return { cells, cols, rows, lastAt };
}

/** The footer's giant dotted wordmark: dots near the cursor turn blue and lean away from it; the full stop leaks. */
function wordmark(canvas) {
  const host = canvas.parentElement.parentElement;
  let mouse = null;
  let grid = null;
  let gridW = 0;
  if (!coarse) {
    host.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; });
    host.addEventListener('pointerleave', () => { mouse = null; });
  }
  const pings = [];
  let nextPing = 0.4;
  animate(canvas, (t) => {
    const { ctx, w, h } = fit(canvas);
    ctx.clearRect(0, 0, w, h);
    const cols = w < 640 ? 74 : 124;
    if (!grid || gridW !== w) { grid = textCells('whatleaks.', cols); gridW = w; }
    const s = w / (grid.cols + 2);
    const r = s * 0.36;
    const top = h - grid.rows * s - s * 0.6;
    for (const c of grid.cells) {
      let x = (c.i + 1.5) * s, y = top + c.j * s;
      let hot = 0;
      if (mouse) {
        const d = Math.hypot(mouse.x - x, mouse.y - y);
        if (d < 130) { hot = 1 - d / 130; x += ((x - mouse.x) / (d || 1)) * hot * 7; y += ((y - mouse.y) / (d || 1)) * hot * 7; }
      }
      const tw = hash(c.i, c.j);
      const shimmer = 0.55 + 0.45 * Math.sin(t * 1.3 + tw * 30 + c.i * 0.08);
      if (c.i >= grid.lastAt && c.cov > 0.3) dot(ctx, x, y, r * (1 + 0.08 * Math.sin(t * 2.4 + tw * 6)), LEAK);
      else if (hot > 0.15) dot(ctx, x, y, r * (1 + hot * 0.25), '#7aa7f7');
      else if (c.cov > 0.6) dot(ctx, x, y, r, `rgba(255,255,255,${0.55 + shimmer * 0.4})`);
      else dot(ctx, x, y, r * 0.9, null, `rgba(255,255,255,${0.28 + shimmer * 0.25})`);
    }
    if (!reduced && t > nextPing && grid.cells.length) {
      const c = grid.cells[Math.floor(Math.random() * grid.cells.length)];
      pings.push({ x: (c.i + 1.5) * s, y: top + c.j * s, t0: t });
      nextPing = t + 0.5 + Math.random();
    }
    for (let k = pings.length - 1; k >= 0; k--) {
      const p = pings[k];
      const a = (t - p.t0) / 1.4;
      if (a > 1) { pings.splice(k, 1); continue; }
      dot(ctx, p.x, p.y, r * 1.1, LEAK);
      ctx.globalAlpha = 1 - a;
      dot(ctx, p.x, p.y, r + a * s * 2.2, null, LEAK);
      ctx.globalAlpha = 1;
    }
  }, 40);
}

/* ---------------------------------------------------------------- dotted illustrations */

const MONO = '"Geist Mono", ui-monospace, Menlo, monospace';
function dotLine(ctx, x1, y1, x2, y2, gap, r, color, ring) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const n = Math.max(1, Math.round(len / gap));
  for (let i = 0; i <= n; i++) dot(ctx, x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n, r, color, ring);
}
function dotRect(ctx, x, y, w, h, gap, r, color, ring) {
  dotLine(ctx, x, y, x + w, y, gap, r, color, ring);
  dotLine(ctx, x, y + h, x + w, y + h, gap, r, color, ring);
  dotLine(ctx, x, y, x, y + h, gap, r, color, ring);
  dotLine(ctx, x + w, y, x + w, y + h, gap, r, color, ring);
}
function dotBlock(ctx, x, y, w, h, gap, r, color, ring) {
  for (let yy = y; yy <= y + h + 0.1; yy += gap) for (let xx = x; xx <= x + w + 0.1; xx += gap) dot(ctx, xx, yy, r, color, ring);
}
function label(ctx, x, y, text, size, color, weight = 400) {
  ctx.font = `${weight} ${size}px ${MONO}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  return ctx.measureText(text).width;
}
/** Text whose ‹labels› are drawn in the accent. */
function labelled(ctx, x, y, text, size, color, accent) {
  for (const part of text.split(/(‹[^›]+›)/)) if (part) x += label(ctx, x, y, part, size, part.startsWith('‹') ? accent : color, part.startsWith('‹') ? 600 : 400);
}

// The numbers drawn here are from real runs of next build (docs/e2e): 8 requests to telemetry.nextjs.org and one to
// the npm registry; 8 → 8 with DO_NOT_TRACK=1, 8 → 0 with NEXT_TELEMETRY_DISABLED=1. The redaction rows are an
// illustration of what the patterns replace.
const SCENES = {
  // Requests leaving `next build` for the two places they went.
  capture(ctx, w, h, t) {
    const g = Math.max(5, w / 70), r = g * 0.3, fs = Math.max(9, h * 0.042);
    const sx = w * 0.07, sw = w * 0.26, sh = h * 0.3, sy = h * 0.35;
    dotRect(ctx, sx, sy, sw, sh, g, r, null, DOT);
    label(ctx, sx + g * 1.7, sy + sh * 0.36, 'next build', fs, INK, 600);
    label(ctx, sx + g * 1.7, sy + sh * 0.68, 'whatleaks run', Math.max(8, fs * 0.82), FAINT);
    const k = reduced ? 1 : (t % 4.6) / 4.6;
    const dests = [
      { y: h * 0.12, host: 'telemetry.nextjs.org', n: 8, size: '≈10.3 KB', color: ACCENT, cat: 'analytics', t0: 0.04 },
      { y: h * 0.64, host: 'registry.npmjs.org', n: 1, size: '≈321 B', color: FAINT, cat: 'other', t0: 0.42 },
    ];
    const dx = w * 0.5, dw = w * 0.44, dh = h * 0.24;
    for (const d of dests) {
      const x0 = sx + sw + g, y0 = sy + sh / 2, x1 = dx - g, y1 = d.y + dh / 2;
      dotLine(ctx, x0, y0, x1, y1, g * 1.25, r * 0.55, DOT2);
      let arrived = 0;
      for (let i = 0; i < d.n; i++) {
        const p = reduced ? 1 : (k - d.t0 - i * 0.055) / 0.2;
        if (p >= 1) { arrived++; continue; }
        if (p > 0) dot(ctx, x0 + (x1 - x0) * ease(p), y0 + (y1 - y0) * ease(p), r * 1.25, d.color);
      }
      const on = arrived > 0;
      const tone = on ? (d.color === ACCENT ? '#1d4ed8' : MUTED) : '#d4d4d8';
      dotRect(ctx, dx, d.y, dw, dh, g, r, null, on ? DOT : DOT2);
      label(ctx, dx + g * 1.6, d.y + dh * 0.34, d.host, Math.max(8.5, h * 0.038), on ? INK : FAINT, 600);
      label(ctx, dx + g * 1.6, d.y + dh * 0.7, `${arrived} req${arrived === d.n ? ` · ${d.size}` : ''}`, Math.max(8, h * 0.034), tone, 500);
      label(ctx, dx + dw - g * 7.5, d.y + dh * 0.7, d.cat, Math.max(8, h * 0.032), tone);
    }
  },
  // Three runs of next build, each row its telemetry requests as dots.
  compare(ctx, w, h, t) {
    const g = Math.max(5, w / 70), r = g * 0.42, fs = Math.max(9, h * 0.042);
    const rows = [
      { name: 'defaults', sent: 8, color: ACCENT, res: '8 requests', rc: '#1d4ed8' },
      { name: 'DO_NOT_TRACK=1', sent: 8, color: LEAK, res: '8 → 8', rc: '#c42b30' },
      { name: 'NEXT_TELEMETRY_DISABLED=1', sent: 0, color: '#22a06b', res: '8 → 0', rc: '#18794e' },
    ];
    const x0 = w * 0.08, top = h * 0.17, rh = h * 0.27;
    const k = reduced ? 99 : t % 7.5;
    rows.forEach((row, i) => {
      const y = top + i * rh;
      const shown = k > i * 1.6;
      label(ctx, x0, y, row.name, fs, shown ? INK : '#d4d4d8', shown ? 600 : 400);
      const step = Math.min(g * 2.4, (w * 0.6) / 8);
      for (let j = 0; j < 8; j++) {
        const x = x0 + r + j * step, yy = y + h * 0.1;
        const on = shown && j < row.sent && k > i * 1.6 + 0.3 + j * 0.09;
        if (on) dot(ctx, x, yy, r, row.color);
        else dot(ctx, x, yy, r * 0.88, null, shown ? (row.sent ? DOT : '#a7dfc4') : DOT2);
      }
      if (shown && k > i * 1.6 + 1.1) label(ctx, x0 + 8 * step + g * 1.4, y + h * 0.1, row.res, fs, row.rc, 600);
    });
  },
  // A capture's fields, scanned: two ids that persist, and the AI agent that ran the build.
  har(ctx, w, h, t) {
    const g = Math.max(5, w / 70), r = g * 0.3, fs = Math.max(8.5, h * 0.038);
    const x = w * 0.07, y = h * 0.09, pw = w * 0.86, ph = h * 0.82;
    dotRect(ctx, x, y, pw, ph, g, r, null, DOT);
    label(ctx, x + g * 2, y + g * 2.2, 'whatleaks-run.har · 9 requests', Math.max(8, fs * 0.92), MUTED);
    const fields = [
      ['context.anonymousId', 'same in every run', 'id'],
      ['context.projectId', 'same in every run', 'id'],
      ['meta.cpuModel', '"Apple M1"', ''],
      ['meta.agentName', 'the AI agent running it', 'leak'],
      ['events[].eventName', '7 names, 22 events', ''],
    ];
    const scan = reduced ? 99 : (t * 0.75) % (fields.length + 2.2);
    fields.forEach(([f, v, kind], i) => {
      const yy = y + h * 0.25 + i * h * 0.125;
      const lit = scan > i + 0.3;
      const col = kind === 'leak' ? LEAK : kind === 'id' ? '#d97706' : FAINT;
      dot(ctx, x + g * 2.6, yy, r * 1.35, lit ? col : DOT2);
      label(ctx, x + g * 4.5, yy, f, fs, lit ? INK : FAINT, kind ? 600 : 400);
      if (lit) label(ctx, x + pw * 0.58, yy, v, Math.max(8, fs * 0.9), kind === 'leak' ? '#c42b30' : kind === 'id' ? '#b45309' : MUTED, kind ? 500 : 400);
    });
    if (!reduced && scan < fields.length) {
      const yy = y + h * 0.25 + scan * h * 0.125 - h * 0.06;
      ctx.globalAlpha = 0.45;
      dotLine(ctx, x + g, yy, x + pw - g, yy, g * 1.4, r * 0.7, ACCENT);
      ctx.globalAlpha = 1;
    }
  },
  // Before and after: what redaction does to a report.
  redact(ctx, w, h, t) {
    const g = Math.max(5, w / 70), r = g * 0.34, fs = Math.max(8.5, h * 0.04);
    const rows = [
      ['/Users/you/.config', '‹home›/.config'],
      ['Authorization: Bearer eyJh…', 'Authorization: ‹redacted›'],
      ['"installId": "3f9c2a…"', '"installId": "‹id-1›"'],
      ['dev@example.com', '‹email›'],
    ];
    const x = w * 0.08;
    const k = reduced ? 99 : t % 7.5;
    rows.forEach(([a, b], i) => {
      const yy = h * 0.2 + i * h * 0.2;
      const p = (k - 0.6 - i * 0.9) / 0.8;
      if (p < 1) {
        ctx.font = `400 ${fs}px ${MONO}`;
        const tw = ctx.measureText(a).width;
        label(ctx, x, yy, a, fs, MUTED);
        if (p > 0) {
          const end = x + tw * ease(p);
          ctx.fillStyle = '#fff';
          ctx.fillRect(x - 2, yy - fs * 0.7, end - x + 2, fs * 1.4);
          for (let xx = x + r; xx < end; xx += g * 1.2) dot(ctx, xx, yy, r, ACCENT);
        }
      } else labelled(ctx, x, yy, b, fs, INK, '#1d4ed8');
    });
  },
  // "ask whatleaks" in dot type with a blinking cursor.
  ask(ctx, w, h, t) {
    const g = Math.max(5, w / 60), r = g * 0.32;
    dotRect(ctx, w * 0.08, h * 0.2, w * 0.84, h * 0.6, g * 1.2, r, ACCENT);
    const cells = textCells('ask whatleaks', 78);
    const s = (w * 0.72) / cells.cols;
    const top = h / 2 - (cells.rows * s) / 2;
    for (const c of cells.cells) dot(ctx, w * 0.13 + c.i * s, top + c.j * s, s * 0.36, c.cov > 0.5 ? INK : null, c.cov > 0.5 ? null : FAINT);
    if (reduced || Math.floor(t * 2) % 2) dotBlock(ctx, w * 0.13 + cells.cols * s + s, top, s * 2, cells.rows * s, s, s * 0.36, LEAK);
  },
};

function scene(canvas) {
  const draw = SCENES[canvas.dataset.scene];
  if (!draw) return;
  animate(canvas, (t) => {
    const { ctx, w, h } = fit(canvas);
    ctx.clearRect(0, 0, w, h);
    draw(ctx, w, h, t);
  }, 24);
}

/**
 * A card's dot illustration: <canvas data-grid="row|row|…"> from the build (scripts/site/build.mjs, ART), one character
 * per dot: '#' solid, '+' light, 'o' hollow, 'r' red (what leaks). The dots shimmer; the red ones pulse.
 */
function artGrid(canvas) {
  const rows = canvas.dataset.grid.split('|');
  const R = rows.length, C = rows[0].length;
  animate(canvas, (t) => {
    const { ctx, w, h } = fit(canvas);
    ctx.clearRect(0, 0, w, h);
    const s = Math.max(w / C, h / R);
    const ox = (w - C * s) / 2, oy = (h - R * s) / 2;
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < C; i++) {
        const ch = rows[j][i];
        if (ch === '.') continue;
        const tw = hash(i, j);
        const a = 0.72 + 0.28 * Math.sin(t * 1.6 + tw * 20);
        const x = ox + (i + 0.5) * s, y = oy + (j + 0.5) * s, rr = s * 0.33;
        if (ch === '#') dot(ctx, x, y, rr, `rgba(255,255,255,${a})`);
        else if (ch === '+') dot(ctx, x, y, rr * 0.9, `rgba(255,255,255,${a * 0.5})`);
        else if (ch === 'o') dot(ctx, x, y, rr * 0.8, null, `rgba(255,255,255,${a * 0.75})`);
        else if (ch === 'r') {
          dot(ctx, x, y, rr * 1.35, 'rgba(255,255,255,.9)');
          dot(ctx, x, y, rr * (1 + 0.12 * Math.sin(t * 3 + tw * 9)), LEAK);
        }
      }
    }
  }, 20);
}

const startCanvases = () => {
  for (const c of document.querySelectorAll('canvas[data-field]')) leakfield(c);
  for (const c of document.querySelectorAll('canvas[data-scene]')) scene(c);
  for (const c of document.querySelectorAll('canvas[data-wordmark]')) wordmark(c);
  for (const c of document.querySelectorAll('canvas[data-grid]')) artGrid(c);
};
// Dot type needs the web font loaded before it is rasterised.
if (document.fonts?.ready) document.fonts.ready.then(startCanvases); else startCanvases();

/* ---------------------------------------------------------------- copy buttons */

const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
const DONE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 12l5 5L20 6"/></svg>';
async function copy(text, btn, labelled) {
  try { await navigator.clipboard.writeText(text); } catch { return; }
  btn.dataset.done = '';
  const prev = btn.innerHTML;
  btn.innerHTML = labelled ? 'Copied' : DONE_ICON;
  setTimeout(() => { delete btn.dataset.done; btn.innerHTML = prev; }, 1600);
}
for (const btn of document.querySelectorAll('[data-copy]')) {
  if (!btn.innerHTML.trim()) btn.innerHTML = COPY_ICON;
  btn.addEventListener('click', () => copy(btn.dataset.copy, btn, btn.dataset.copyLabel !== undefined));
}
// Code blocks get a Copy button that leaves out comments and the "$ " prompts.
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

/* ---------------------------------------------------------------- nav: a menu on phones, a floating capsule once scrolled */

const nav = document.querySelector('.nav');
nav?.querySelector('.menu-btn')?.addEventListener('click', (e) => {
  const open = nav.classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', String(open));
});
nav?.querySelectorAll('.links a').forEach((a) => a.addEventListener('click', () => nav.classList.remove('open')));
const onScroll = () => nav?.classList.toggle('scrolled', window.scrollY > 12);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ---------------------------------------------------------------- tabs: [role=tablist] > button[aria-controls] */

for (const list of document.querySelectorAll('[role="tablist"]')) {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const select = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const pane = document.getElementById(t.getAttribute('aria-controls'));
      if (pane) pane.hidden = !on;
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

/* ---------------------------------------------------------------- the hero's tool picker: measured results, not live */

const toolData = document.getElementById('tool-data');
const picker = document.querySelector('[data-picker]');
if (toolData && picker) {
  const tools = JSON.parse(toolData.textContent);
  const out = document.querySelector(picker.dataset.picker);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const render = (key) => {
    const t = tools[key];
    out.replaceChildren();
    const head = el('div', 'head');
    head.append(el('b', '', `${t.name} ${t.version}`), el('code', '', t.cmd), el('span', 'count', t.count));
    const dest = el('div', 'dest');
    dest.append(el('span', 'host', t.host), el('span', 'cat', t.cat), el('span', 'n', t.sent));
    const opts = el('div', 'optouts');
    for (const o of t.optouts) {
      const box = el('div', `optout ${o.kind}`);
      box.append(el('code', '', o.var), el('span', 'res', o.res), el('small', '', o.why));
      opts.append(box);
    }
    const notes = el('ul', 'notes');
    for (const n of t.notes) notes.append(el('li', '', n));
    const fine = el('p', 'fine');
    const a = el('a', '', t.source);
    a.href = t.href; a.target = '_blank'; a.rel = 'noopener';
    fine.append(document.createTextNode(`${t.fine} Source: `), a);
    out.append(head, dest, opts, notes, fine);
  };
  const buttons = [...picker.querySelectorAll('button[data-tool]')];
  for (const b of buttons) {
    b.addEventListener('click', () => {
      for (const x of buttons) x.setAttribute('aria-pressed', String(x === b));
      render(b.dataset.tool);
    });
  }
  render(buttons.find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset.tool ?? buttons[0].dataset.tool);
}

/* ---------------------------------------------------------------- carousel */

for (const car of document.querySelectorAll('[data-carousel]')) {
  const track = car.querySelector('.carousel');
  const pips = car.querySelector('.pips');
  const cards = [...track.children];
  pips?.replaceChildren(...cards.map(() => document.createElement('i')));
  const step = () => (cards[0]?.getBoundingClientRect().width ?? 300) + 16;
  car.querySelector('[data-prev]')?.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: reduced ? 'auto' : 'smooth' }));
  car.querySelector('[data-next]')?.addEventListener('click', () => track.scrollBy({ left: step(), behavior: reduced ? 'auto' : 'smooth' }));
  const mark = () => {
    const i = Math.round(track.scrollLeft / step());
    pips?.querySelectorAll('i').forEach((p, k) => p.classList.toggle('on', k === Math.min(i, cards.length - 1)));
  };
  track.addEventListener('scroll', mark, { passive: true });
  mark();
}

/* ---------------------------------------------------------------- reveal on scroll */

const io = 'IntersectionObserver' in window && !reduced
  ? new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px' })
  : null;
for (const el of document.querySelectorAll('.reveal')) {
  if (io) io.observe(el);
  else el.classList.add('in');
}

/* ---------------------------------------------------------------- session replay: steps appear in their recorded order */

for (const session of document.querySelectorAll('.session[data-play]')) {
  if (reduced || !('IntersectionObserver' in window)) continue;
  const steps = [...session.querySelectorAll('.step')];
  session.classList.add('play');
  const delays = steps.map((s) => Number(s.dataset.delay || 900));
  const run = () => {
    let t = 250;
    steps.forEach((s, i) => {
      t += i ? delays[i] : 0;
      setTimeout(() => s.classList.add('on'), t);
    });
  };
  const sio = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { sio.disconnect(); run(); }
  }, { rootMargin: '0px 0px -20% 0px' });
  sio.observe(session);
}

/* ---------------------------------------------------------------- tooltips: values lead, labels follow; text only */

function tooltip(host, tip) {
  return {
    show(lines, x, y) {
      tip.replaceChildren();
      const v = document.createElement('div'); v.className = 'v'; v.textContent = lines.value; tip.append(v);
      const k = document.createElement('div'); k.className = 'k';
      const key = document.createElement('i'); if (lines.key) key.className = lines.key; if (lines.color) key.style.background = lines.color;
      const name = document.createElement('span'); name.textContent = lines.label;
      k.append(key, name); tip.append(k);
      if (lines.sub) { const s = document.createElement('div'); s.className = 's'; s.textContent = lines.sub; tip.append(s); }
      tip.style.left = Math.max(8, Math.min(x + 14, host.clientWidth - tip.offsetWidth - 8)) + 'px';
      tip.style.top = y + 16 + 'px';
      tip.style.opacity = 1;
    },
    hide() { tip.style.opacity = 0; },
  };
}
const pct = (v) => `${v}%`;

/* ---------------------------------------------------------------- dot bar charts: <div class="chart" data-sets='{"macOS": [{name, value, count, hl}]}'> */

for (const chart of document.querySelectorAll('.chart[data-sets]')) {
  const sets = JSON.parse(chart.dataset.sets);
  const metric = chart.dataset.metric || 'silently missed';
  const bars = chart.querySelector('.bars');
  const tip = tooltip(chart, chart.querySelector('.tip'));
  let grown = false;
  const render = (set) => {
    bars.replaceChildren();
    for (const d of sets[set]) {
      const row = document.createElement('div');
      row.className = 'bar-row' + (d.hl ? ' hl' : '');
      row.tabIndex = 0;
      row.setAttribute('role', 'listitem');
      const value = d.label ?? pct(d.value);
      row.setAttribute('aria-label', `${d.name}: ${value} of attempts ${metric} on ${set} (${d.count})`);
      row.innerHTML = '<span class="name"></span><span class="track"><span class="fill"></span></span><span class="val"></span>';
      row.querySelector('.name').textContent = d.name;
      row.querySelector('.val').textContent = value;
      const fill = row.querySelector('.fill');
      fill.dataset.w = `${d.value}%`;
      if (grown) fill.style.width = fill.dataset.w;
      const lines = { value, label: `${d.name} · ${metric}`, sub: `${d.count} attempts, ${set}`, key: d.hl ? 'blue' : '' };
      row.addEventListener('mousemove', (e) => { const r = chart.getBoundingClientRect(); tip.show(lines, e.clientX - r.left, e.clientY - r.top); });
      row.addEventListener('focus', () => tip.show(lines, row.offsetLeft + 220, row.offsetTop + row.offsetHeight - 6));
      row.addEventListener('mouseleave', () => tip.hide());
      row.addEventListener('blur', () => tip.hide());
      bars.append(row);
    }
  };
  const seg = chart.querySelector('.seg');
  seg?.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    for (const x of seg.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
    render(b.dataset.set);
  });
  render(Object.keys(sets)[0]);
  const grow = () => { grown = true; for (const f of chart.querySelectorAll('.fill')) f.style.width = f.dataset.w; };
  if (reduced || !('IntersectionObserver' in window)) grow();
  else {
    const cio = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { cio.disconnect(); requestAnimationFrame(grow); } }, { threshold: 0.3 });
    cio.observe(chart);
  }
}

/* ---------------------------------------------------------------- stacked outcome bars (benchmark): data-stacks='{"keys", "rows"}' */

for (const viz of document.querySelectorAll('.viz[data-stacks]')) {
  const data = JSON.parse(viz.dataset.stacks);
  const host = viz.querySelector('.stacks');
  let tipEl = viz.querySelector('.tip');
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; tipEl.setAttribute('role', 'status'); viz.append(tipEl); }
  const tip = tooltip(viz, tipEl);
  const colors = ['#1e3a8a', '#2563eb', '#6ea8f7'];
  const hook = (s, lines) => {
    s.addEventListener('pointermove', (e) => { const r = viz.getBoundingClientRect(); tip.show(lines, e.clientX - r.left, e.clientY - r.top); });
    s.addEventListener('pointerleave', () => tip.hide());
    s.addEventListener('focus', () => { const r = viz.getBoundingClientRect(), b = s.getBoundingClientRect(); tip.show(lines, b.left - r.left, b.bottom - r.top); });
    s.addEventListener('blur', () => tip.hide());
  };
  for (const d of data.rows) {
    const row = document.createElement('div'); row.className = 'row' + (d.hl ? ' hl' : '');
    const name = document.createElement('span'); name.className = 'name'; name.textContent = d.name;
    const bar = document.createElement('div'); bar.className = 'bar'; bar.setAttribute('role', 'list');
    const total = d.parts.reduce((a, b) => a + b, 0) + d.missed;
    d.parts.forEach((p, i) => {
      if (!p) return;
      const s = document.createElement('span'); s.className = 'seg-o'; s.tabIndex = 0; s.setAttribute('role', 'listitem');
      s.style.width = `${(p / total) * 100}%`; s.style.background = colors[i];
      s.setAttribute('aria-label', `${d.name}: ${pct(p)} ${data.keys[i]}`);
      hook(s, { value: pct(p), label: data.keys[i], sub: d.name, color: colors[i] });
      bar.append(s);
    });
    // The remainder is what nothing in the tool's output points to.
    const m = document.createElement('span'); m.className = 'seg-o missed'; m.tabIndex = 0; m.setAttribute('role', 'listitem');
    m.style.width = `${(d.missed / total) * 100}%`;
    const missed = d.missedLabel ?? pct(d.missed);
    m.setAttribute('aria-label', `${d.name}: ${missed} silently missed (${d.count})`);
    hook(m, { value: missed, label: 'silently missed', sub: `${d.name} · ${d.count}`, color: '#d4d4d8' });
    bar.append(m);
    const val = document.createElement('span'); val.className = 'val';
    val.textContent = `${missed} missed`;
    const small = document.createElement('small'); small.textContent = d.count; val.append(small);
    row.append(name, bar, val);
    host.append(row);
  }
}

/* ---------------------------------------------------------------- docs table of contents */

const tocLinks = [...document.querySelectorAll('.toc a[href^="#"]')];
if (tocLinks.length && 'IntersectionObserver' in window) {
  const byId = new Map(tocLinks.map((a) => [a.getAttribute('href').slice(1), a]));
  const tio = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) {
      for (const a of tocLinks) {
        const on = a === byId.get(e.target.id);
        a.classList.toggle('active', on);
        if (on && matchMedia('(max-width: 960px)').matches) { const ol = a.closest('ol'); ol?.scrollTo({ left: a.offsetLeft - ol.clientWidth / 2 + a.clientWidth / 2, behavior: reduced ? 'auto' : 'smooth' }); }
      }
    }
  }, { rootMargin: '-20% 0px -70% 0px' });
  for (const id of byId.keys()) { const s = document.getElementById(id); if (s) tio.observe(s); }
}
