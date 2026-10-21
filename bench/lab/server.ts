import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import dgram from 'node:dgram';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http2 from 'node:http2';
import type { IncomingMessage } from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import net from 'node:net';
import type { TLSSocket } from 'node:tls';
import os from 'node:os';
import { join } from 'node:path';

/** What the lab saw arrive. Clients log what they *tried* to send in their own ledger. */
export interface LabEvent {
  at: number;
  kind: 'conn' | 'http' | 'ws' | 'tcp' | 'udp' | 'tls-error';
  listener: 'h1' | 'h2' | 'tcp' | 'udp';
  path?: string;
  method?: string;
  bodySha?: string;
  bodyLen?: number;
  remotePort?: number;
  text?: string;
}

export interface LabInfo {
  ip: string;
  /** `<ip-with-dashes>.sslip.io`: resolves to `ip` through public DNS. */
  host: string;
  /** HTTPS (HTTP/1.1) and WebSocket. */
  port: number;
  /** HTTPS with HTTP/2 (and HTTP/1.1 fallback). */
  h2Port: number;
  tcpPort: number;
  udpPort: number;
  /** The lab CA. The benchmark process trusts it (NODE_EXTRA_CA_CERTS) so the capture proxy can reach the lab. */
  caPath: string;
}

export interface Lab extends LabInfo {
  events: LabEvent[];
  close(): Promise<void>;
}

export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

/** The machine's first non-internal IPv4 address that is not a VPN point-to-point address. */
export function lanAddress(): string {
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (name.startsWith('utun') || name.startsWith('lo')) continue;
    const a = addrs?.find((x) => x.family === 'IPv4' && !x.internal);
    if (a) return a.address;
  }
  throw new Error('no LAN IPv4 address: the lab needs one so proxy-ignoring clients make a real non-loopback connection');
}

/** A lab CA and a leaf for the sslip.io name, made once with openssl and reused. */
export function labCerts(dir: string, host: string, ip: string): { caPath: string; key: string; cert: string } {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const p = (f: string): string => join(dir, f);
  const tag = p(`leaf-${host}.pem`);
  if (!existsSync(p('ca.pem'))) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', p('ca.key'), '-out', p('ca.pem'), '-days', '60',
      '-subj', '/CN=whatleaks bench lab CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign'], { stdio: 'ignore' });
  }
  if (!existsSync(tag)) {
    writeFileSync(p('leaf.ext'), `subjectAltName=DNS:${host},IP:${ip}\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n`);
    execFileSync('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', p('leaf.key'), '-out', p('leaf.csr'), '-subj', `/CN=${host}`], { stdio: 'ignore' });
    execFileSync('openssl', ['x509', '-req', '-in', p('leaf.csr'), '-CA', p('ca.pem'), '-CAkey', p('ca.key'), '-CAcreateserial', '-out', tag, '-days', '60', '-extfile', p('leaf.ext')], { stdio: 'ignore' });
  }
  return { caPath: p('ca.pem'), key: readFileSync(p('leaf.key'), 'utf8'), cert: readFileSync(tag, 'utf8') };
}

interface WsSocket {
  on(event: 'message', cb: (data: Buffer, isBinary: boolean) => void): void;
}
interface WsServer {
  handleUpgrade(req: unknown, socket: unknown, head: Buffer, cb: (ws: WsSocket) => void): void;
}
// `ws` ships with mockttp; the lab borrows it rather than adding a dependency.
const { WebSocketServer } = createRequire(import.meta.url)('ws') as { WebSocketServer: new (o: { noServer: true }) => WsServer };

function listen(server: net.Server, ip: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, ip, () => resolve((server.address() as net.AddressInfo).port));
  });
}

/** Waits out a Wi-Fi drop (up to 30 minutes) rather than failing a long benchmark chain. */
async function waitLanAddress(): Promise<string> {
  for (let i = 0; ; i++) {
    try {
      return lanAddress();
    } catch (e) {
      if (i >= 360) throw e;
      if (i === 0) console.error('no LAN address yet; waiting for the network');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

export async function startLab(certDir: string): Promise<Lab> {
  const ip = await waitLanAddress();
  const host = `${ip.replace(/\./g, '-')}.sslip.io`;
  const { caPath, key, cert } = labCerts(certDir, host, ip);
  const events: LabEvent[] = [];
  const log = (e: Omit<LabEvent, 'at'>): void => {
    events.push({ at: Date.now(), ...e });
  };

  type Req = Pick<IncomingMessage, 'on' | 'url' | 'method'> & { socket: { remotePort?: number } };
  type Res = { writeHead(status: number, headers: Record<string, string>): unknown; end(body: string): unknown };
  const onRequest = (listener: 'h1' | 'h2') => (req: Req, res: Res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      log({ kind: 'http', listener, path: (req.url ?? '').split('?')[0]!, method: req.method ?? '', bodySha: sha256(body), bodyLen: body.length, remotePort: req.socket.remotePort ?? 0 });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  };

  const h1 = https.createServer({ key, cert }, (req, res) => onRequest('h1')(req, res));
  const wss = new WebSocketServer({ noServer: true });
  h1.on('upgrade', (req: IncomingMessage, socket: net.Socket, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0]!;
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (data, isBinary) => log({ kind: 'ws', listener: 'h1', path, text: isBinary ? `<binary ${data.length}>` : data.toString('utf8'), bodySha: sha256(data) }));
    });
  });
  const h2 = http2.createSecureServer({ key, cert, allowHTTP1: true }, (req, res) => onRequest('h2')(req as unknown as Req, res));
  for (const [s, listener] of [[h1, 'h1'], [h2, 'h2']] as const) {
    s.on('secureConnection', (t: TLSSocket) => log({ kind: 'conn', listener, remotePort: t.remotePort ?? 0 }));
    s.on('tlsClientError', () => log({ kind: 'tls-error', listener }));
  }

  const tcp = net.createServer((sock) => {
    log({ kind: 'conn', listener: 'tcp', remotePort: sock.remotePort ?? 0 });
    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      const line = buf.slice(0, nl);
      log({ kind: 'tcp', listener: 'tcp', path: line.replace(/ .*$/, ''), remotePort: sock.remotePort ?? 0 });
      // "<path> close": the server closes first, so the client side never enters TIME_WAIT.
      if (line.endsWith(' close')) sock.end();
    });
    sock.on('error', () => {});
  });

  const udp = dgram.createSocket('udp4');
  udp.on('message', (msg, rinfo) => log({ kind: 'udp', listener: 'udp', path: msg.toString('utf8').trim(), remotePort: rinfo.port }));

  const port = await listen(h1, ip);
  const h2Port = await listen(h2, ip);
  const tcpPort = await listen(tcp, ip);
  const udpPort = await new Promise<number>((r) => udp.bind(0, ip, () => r(udp.address().port)));

  return {
    ip,
    host,
    port,
    h2Port,
    tcpPort,
    udpPort,
    caPath,
    events,
    close: async () => {
      for (const s of [h1, h2, tcp]) {
        (s as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
        await new Promise<void>((r) => s.close(() => r()));
      }
      udp.close();
    },
  };
}
