// Renders scripts/video/demo.html with headless Chrome over the DevTools protocol (no dependencies): seeks the page frame
// by frame and pipes the frames to ffmpeg. Needs Chrome (or CHROME=/path/to/chrome) and ffmpeg.
//   node scripts/video/render.mjs                  the video, its poster and the README GIF
//   node scripts/video/render.mjs --gif            the README GIF only
//   node scripts/video/render.mjs --stills 2,28    PNG stills of the video at those seconds, in video-out/
//   node scripts/video/render.mjs --gif --stills 0,9   the same for the GIF layout (seconds from its start)
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const page = pathToFileURL(join(root, 'scripts/video/demo.html')).href;
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const stills = flag('--stills')?.split(',').map(Number);
const gifOnly = args.includes('--gif');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(query, width, height) {
  const profile = mkdtempSync(join(tmpdir(), 'wl-video-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--allow-file-access-from-files', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  let port;
  for (let i = 0; i < 300 && !port; i++) {
    const f = join(profile, 'DevToolsActivePort');
    if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0];
    else await sleep(100);
  }
  if (!port) throw new Error(`Chrome did not start (${CHROME})`);
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  let loaded = false;
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method === 'Page.loadEventFired') loaded = true;
  };
  const send = (method, params = {}) => new Promise((r, j) => {
    const i = ++id;
    pending.set(i, (msg) => (msg.error ? j(new Error(`${method}: ${msg.error.message}`)) : r(msg.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const run = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${expression}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${page}${query}` });
  for (let i = 0; i < 300 && !loaded; i++) await sleep(50);
  await run('window.READY');
  const shot = async (t) => {
    await run(`seek(${t})`);
    return Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
  };
  const close = async () => { ws.close(); chrome.kill('SIGKILL'); await sleep(300); rmSync(profile, { recursive: true, force: true }); };
  return { run, shot, close };
}

function ffmpeg(argv) {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...argv], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((r, j) => ff.on('close', (c) => (c === 0 ? r() : j(new Error(`ffmpeg exited ${c}`)))));
  return { stdin: ff.stdin, done };
}
async function pipeFrames(p, from, to, fps, out) {
  const frames = Math.round((to - from) * fps);
  for (let i = 0; i < frames; i++) {
    const png = await p.shot(from + i / fps);
    if (!out.write(png)) await new Promise((r) => out.once('drain', r));
    if (i % (fps * 5) === 0) process.stderr.write(`  ${(i / fps).toFixed(0)}s / ${(to - from).toFixed(1)}s\n`);
  }
  out.end();
}
const size = (f) => `${f} (${(statSync(f).size / 1024 / 1024).toFixed(2)} MB)`;

if (stills) {
  const out = join(root, 'video-out');
  mkdirSync(out, { recursive: true });
  const p = gifOnly ? await open('?gif', 1200, 800) : await open('', 1920, 1080);
  const [from] = await p.run('window.RANGE');
  for (const t of stills) writeFileSync(join(out, `${gifOnly ? 'gif' : 'video'}-${t}.png`), await p.shot(from + t));
  console.log(await p.run('JSON.stringify({ range: window.RANGE, cues: window.CUES })'));
  await p.close();
  console.log(`wrote ${out}/`);
  process.exit(0);
}

const media = join(root, 'site/media');
mkdirSync(media, { recursive: true });
mkdirSync(join(root, 'docs/media'), { recursive: true });

if (!gifOnly) {
  // The video: 1920x1080, 30 fps, H.264 for X, LinkedIn and the site. The poster is the title card.
  const p = await open('', 1920, 1080);
  const [from, to] = await p.run('window.RANGE');
  writeFileSync(join(media, 'whatleaks-demo-poster.png'), await p.shot(2));
  const mp4 = join(media, 'whatleaks-demo.mp4');
  const ff = ffmpeg(['-f', 'image2pipe', '-framerate', '30', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  await pipeFrames(p, from, to, 30, ff.stdin);
  await ff.done;
  await p.close();
  console.log(`wrote ${size(mp4)} and the poster`);
}

{
  // The README GIF: the two comparisons at 1200x800, 12 fps, one shared palette, no dithering (flat terminal colours).
  // The loop is rotated to start on the DO_NOT_TRACK result, so the first frame (all that shows before the GIF plays,
  // or with reduced motion) says something.
  const p = await open('?gif', 1200, 800);
  const [from, to] = await p.run('window.RANGE');
  const cues = await p.run('window.CUES');
  const dir = mkdtempSync(join(tmpdir(), 'wl-gif-'));
  const fps = 12;
  const n = Math.round((to - from) * fps);
  const first = Math.round((cues.dnt + 0.9 - from) * fps);
  for (let i = 0; i < n; i++) writeFileSync(join(dir, `f${String(i).padStart(4, '0')}.png`), await p.shot(from + ((first + i) % n) / fps));
  await p.close();
  const frames = join(dir, 'f%04d.png');
  await ffmpeg(['-framerate', String(fps), '-i', frames, '-vf', 'palettegen=max_colors=128:stats_mode=full', join(dir, 'palette.png')]).done;
  const gif = join(root, 'docs/media/whatleaks-demo.gif');
  await ffmpeg(['-framerate', String(fps), '-i', frames, '-i', join(dir, 'palette.png'), '-lavfi', 'paletteuse=dither=none:diff_mode=rectangle', '-loop', '0', gif]).done;
  console.log(`wrote ${size(gif)} from ${readdirSync(dir).length - 1} frames`);
  rmSync(dir, { recursive: true, force: true });
}
