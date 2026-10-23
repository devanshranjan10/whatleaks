// whatleaks.me edge, for everything but /assets/ and /fonts/ (see run_worker_first in wrangler.jsonc):
// - http:// and www. redirect to https://whatleaks.me;
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol === 'http:' || url.hostname === `www.${HOST}`) {
      url.protocol = 'https:';
      url.hostname = HOST;
      return Response.redirect(url.toString(), 301);
    }
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
