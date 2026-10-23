// whatleaks.me edge, for everything but /assets/ and /fonts/ (see run_worker_first in wrangler.jsonc):
// - http:// and www. redirect to https://whatleaks.me;
// - /media/ files answer byte-range requests (static assets don't, and Safari won't play a video without them);
// - agents that ask for Markdown (Accept: text/markdown) get the page's .md twin;
// - HTML pages advertise that twin, and llms.txt, in Link headers;
// - HTML is sent with Cache-Control: no-transform, so Cloudflare injects nothing into it (it would otherwise add its
//   Web Analytics beacon to a site that promises to send nothing about its visitors).
// Files are served from static assets, with the headers in site/_headers.

const HOST = 'whatleaks.me';
const MARKDOWN = { '/': '/index.md', '/docs/': '/docs.md', '/benchmark/': '/benchmark.md', '/faq/': '/faq.md' };
const HTML_CACHE = 'public, max-age=0, must-revalidate, no-transform';

function wantsMarkdown(accept) {
  if (!accept) return false;
  const q = (type) => {
    const m = accept.split(',').map((s) => s.trim()).find((s) => s.split(';')[0].trim() === type);
    if (!m) return -1;
    const v = /;\s*q=([\d.]+)/.exec(m);
    return v ? Number(v[1]) : 1;
  };
  return q('text/markdown') > Math.max(q('text/html'), 0);
}

/** Serve one `Range: bytes=a-b` slice of a static asset as 206; anything else gets the whole file. */
async function ranged(request, env) {
  const res = await env.ASSETS.fetch(request);
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  if (request.method !== 'GET' || !res.ok || !m || (m[1] === '' && m[2] === '')) {
    const out = new Response(res.body, res);
    out.headers.set('Accept-Ranges', 'bytes');
    return out;
  }
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  const out = new Response(buf.slice(start, end + 1), { status: 206, headers: res.headers });
  out.headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  out.headers.set('Content-Length', String(end - start + 1));
  out.headers.set('Accept-Ranges', 'bytes');
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol === 'http:' || url.hostname === `www.${HOST}`) {
      url.protocol = 'https:';
      url.hostname = HOST;
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname.startsWith('/media/')) return ranged(request, env);
    const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
    const md = MARKDOWN[path];
    if (md && wantsMarkdown(request.headers.get('accept'))) {
      const res = await env.ASSETS.fetch(new Request(new URL(md, url), request));
      const out = new Response(res.body, res);
      out.headers.set('Vary', 'Accept');
      return out;
    }
    const res = await env.ASSETS.fetch(request);
    if (!(res.headers.get('content-type') ?? '').startsWith('text/html')) return res;
    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', HTML_CACHE);
    if (md) {
      out.headers.append('Link', `<${md}>; rel="alternate"; type="text/markdown"`);
      out.headers.append('Link', '</llms.txt>; rel="describedby"; type="text/plain"');
      out.headers.set('Vary', 'Accept');
    }
    return out;
  },
};
