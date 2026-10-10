import { connect, createServer, type Server, type Socket } from 'node:net';

const MAX_HEADER_BYTES = 64 * 1024;

export interface RelayOptions {
  /** Port agent shells point HTTPS_PROXY at. Always listening, even when the app is closed. */
  port: number;
  /** The Keybroker app's real proxy port. */
  upstreamPort: number;
  host?: string;
  onError?: (err: Error) => void;
}

/**
 * Always-on front door for the proxy. While the Keybroker app is running, every connection
 * is passed through to it untouched. While it isn't, the relay behaves as a plain forward
 * proxy, so agent shells keep working exactly as they would without Keybroker.
 * It never sees or holds a secret.
 */
export function startRelay(options: RelayOptions): Promise<Server> {
  const host = options.host ?? '127.0.0.1';

  const server = createServer((client) => {
    // Collect bytes rather than pausing: Bun (which runs the compiled CLI) doesn't redeliver
    // data to a listener added after resume(), so nothing here relies on pause/resume.
    const early: Buffer[] = [];
    const collect = (chunk: Buffer) => early.push(chunk);
    client.on('data', collect);
    client.on('error', () => client.destroy());
    const upstream = connect(options.upstreamPort, '127.0.0.1');
    upstream.once('connect', () => {
      client.off('data', collect);
      for (const chunk of early) upstream.write(chunk);
      join(client, upstream);
    });
    upstream.once('error', () => {
      upstream.destroy();
      client.off('data', collect);
      direct(client, Buffer.concat(early));
    });
  });
  server.on('error', (err) => options.onError?.(err));

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, host, () => resolve(server));
  });
}

/** Once two sockets are joined, either side going away closes the other. */
function join(a: Socket, b: Socket) {
  a.on('error', () => b.destroy());
  b.on('error', () => a.destroy());
  a.on('close', () => b.destroy());
  b.on('close', () => a.destroy());
  a.pipe(b).pipe(a);
}

/** Minimal forward proxy: CONNECT tunnels, plus plain-HTTP absolute-form requests. */
function direct(client: Socket, initial: Buffer) {
  let buffered = initial;
  // Bytes that arrive while the outbound connection is being opened.
  let pending: Buffer[] | undefined;
  const fail = (status: string) => {
    client.off('data', onData);
    client.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };

  function open(port: number, hostname: string, preamble: string | undefined, rest: Buffer) {
    pending = rest.length ? [rest] : [];
    const remote = connect(port, hostname);
    remote.once('connect', () => {
      client.off('data', onData);
      if (preamble === undefined) client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      else remote.write(preamble);
      for (const chunk of pending!) remote.write(chunk);
      join(client, remote);
    });
    remote.once('error', () => fail('502 Bad Gateway'));
  }

  function parse() {
    const end = buffered.indexOf('\r\n\r\n');
    if (end === -1) {
      if (buffered.length > MAX_HEADER_BYTES) fail('431 Request Header Fields Too Large');
      return;
    }
    const head = buffered.subarray(0, end).toString('latin1');
    const rest = buffered.subarray(end + 4);
    const [requestLine, ...headerLines] = head.split('\r\n');
    const [method, target, version] = requestLine.split(' ');

    if (method === 'CONNECT') {
      const { hostname, port } = parseAuthority(target, 443);
      if (!hostname) return fail('400 Bad Request');
      return open(port, hostname, undefined, rest);
    }

    let url: URL;
    try {
      url = new URL(target);
    } catch {
      return fail('400 Bad Request');
    }
    if (url.protocol !== 'http:') return fail('400 Bad Request');
    // Origin-form request line, and one request per connection keeps this simple.
    const headers = headerLines.filter((l) => !/^(proxy-connection|connection|keep-alive):/i.test(l));
    const preamble = `${method} ${url.pathname}${url.search} ${version}\r\n${[...headers, 'Connection: close'].join('\r\n')}\r\n\r\n`;
    open(Number(url.port || 80), url.hostname, preamble, rest);
  }

  function onData(chunk: Buffer) {
    if (pending) pending.push(chunk);
    else {
      buffered = Buffer.concat([buffered, chunk]);
      parse();
    }
  }

  client.on('data', onData);
  parse();
}

function parseAuthority(authority: string, defaultPort: number): { hostname?: string; port: number } {
  const match = authority?.match(/^\[?([^\]]+?)\]?(?::(\d+))?$/);
  if (!match) return { port: defaultPort };
  return { hostname: match[1], port: Number(match[2] ?? defaultPort) };
}
