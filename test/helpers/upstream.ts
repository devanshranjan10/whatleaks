import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Upstream {
  url: string;
  received: Array<{ method: string; path: string; body: string }>;
  close(): Promise<void>;
}

/** A local HTTP server standing in for the internet. */
export async function startUpstream(): Promise<Upstream> {
  const received: Upstream['received'] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      received.push({ method: req.method ?? '', path: req.url ?? '', body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    received,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
