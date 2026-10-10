import { randomUUID } from 'node:crypto';
import * as mockttp from 'mockttp';
import {
  applyAuth,
  findCredentialForHost,
  findPlaceholders,
  scrubBuffer,
  scrubString,
  secretVariants,
  type AuthScheme,
  type CertificateAuthority,
  type Headers,
  type ResolvedCredential,
} from '@keybroker/core';

export interface ProxyEvent {
  id: string;
  time: string;
  action: 'injected' | 'blocked';
  credential?: string;
  method: string;
  host: string;
  path: string;
  status?: number;
  reason?: string;
  redactions?: number;
}

export interface CapturedMessage {
  headers: Record<string, string>;
  /** Text bodies only, truncated to MAX_CAPTURE_BYTES. */
  body?: string;
  bodyBytes: number;
  bodyTruncated?: boolean;
  contentType?: string;
}

/**
 * What the Activity view shows for one request. The request is what the agent sent
 * (before the key was attached); the response is after scrubbing. Never contains a secret.
 */
export interface ProxyEventDetail {
  request: CapturedMessage & {
    method: string;
    url: string;
    /** Where Keybroker attached the key, e.g. `header xi-api-key` or `query api_key`. */
    injectedAt?: string;
  };
  response?: CapturedMessage & { status: number };
}

export interface ProxyOptions {
  ca: CertificateAuthority;
  /** Called per request, so credential changes apply without a restart. */
  credentials: () => ResolvedCredential[];
  port?: number;
  onEvent?: (event: ProxyEvent, detail: ProxyEventDetail) => void;
  /** Tests only: trust these upstream CAs in addition to the system ones. */
  upstreamCAs?: string[];
}

export interface RunningProxy {
  port: number;
  url: string;
  /** Re-read the credential host list and restart TLS interception to match. */
  reload(): Promise<void>;
  stop(): Promise<void>;
}

/** Responses bigger than this can't be buffered for scrubbing, so they're blocked rather than passed through unchecked. */
const MAX_SCRUB_BYTES = 50 * 1024 * 1024;
const MAX_PLACEHOLDER_SCAN_BYTES = 1024 * 1024;
const MAX_CAPTURE_BYTES = 64 * 1024;
const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|problem\+json|[\w.+-]*\+json|[\w.+-]*\+xml))/i;

function flatHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]),
  );
}

function capture(headers: Headers, body: Buffer): CapturedMessage {
  const flat = flatHeaders(headers);
  const contentType = flat['content-type'];
  const isText = body.length === 0 || !contentType || TEXT_TYPES.test(contentType);
  return {
    headers: flat,
    contentType,
    bodyBytes: body.length,
    ...(isText && body.length > 0 ? { body: body.subarray(0, MAX_CAPTURE_BYTES).toString('utf8') } : {}),
    ...(isText && body.length > MAX_CAPTURE_BYTES ? { bodyTruncated: true } : {}),
  };
}

function injectedAt(auth: AuthScheme): string {
  switch (auth.type) {
    case 'header':
      return `header ${auth.header.toLowerCase()}`;
    case 'query':
      return `query ${auth.param}`;
    default:
      return 'header authorization';
  }
}

export function generateCA(): Promise<CertificateAuthority> {
  return mockttp.generateCACertificate({
    subject: { commonName: 'Keybroker Local CA', organizationName: 'Keybroker' },
  });
}

function blocked(message: string, extra: Record<string, unknown> = {}) {
  return {
    statusCode: 403,
    headers: { 'content-type': 'application/json', 'x-keybroker': 'blocked' },
    body: JSON.stringify({ error: 'keybroker_blocked', message, ...extra }, null, 2),
  };
}

function headerText(headers: Headers): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : (v ?? '')}`)
    .join('\n');
}

function scrubHeaders(headers: Headers, needles: string[]): { headers: Headers; changed: boolean } {
  let changed = false;
  const out: Headers = {};
  for (const [key, value] of Object.entries(headers)) {
    const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
    const scrubbed = values.map((v) => scrubString(v, needles));
    if (scrubbed.some((v, i) => v !== values[i])) changed = true;
    out[key] = Array.isArray(value) ? scrubbed : scrubbed[0];
  }
  return { headers: out, changed };
}

/**
 * HTTPS proxy that attaches stored credentials to requests bound for their hosts, and
 * removes the secret from anything that comes back. Only credential hosts are
 * TLS-intercepted; all other traffic is tunnelled untouched.
 */
export async function startProxy(options: ProxyOptions): Promise<RunningProxy> {
  const emit = (event: Omit<ProxyEvent, 'time' | 'id'>, detail: ProxyEventDetail) =>
    options.onEvent?.({ id: randomUUID(), time: new Date().toISOString(), ...event }, detail);
  // Per-request record of what we injected, keyed by mockttp request id, for response scrubbing.
  const injected = new Map<string, { credential: string; needles: string[]; request: ProxyEventDetail['request'] }>();

  const interceptHosts = () => [
    ...new Set(options.credentials().flatMap((c) => c.credential.hosts)),
  ];

  let server: mockttp.Mockttp | undefined;
  let port = options.port ?? 0;

  async function start() {
    const hosts = interceptHosts();
    server = mockttp.getLocal({
      https: {
        key: options.ca.key,
        cert: options.ca.cert,
        // An empty list would intercept nothing, which is what we want with no credentials.
        tlsInterceptOnly: hosts.map((hostname) => ({ hostname })),
      },
      http2: false,
    });

    await server
      .forAnyRequest()
      .thenPassThrough({
        additionalTrustedCAs: options.upstreamCAs?.map((cert) => ({ cert })),
        beforeRequest: async (req) => {
          const url = new URL(req.url);
          const host = url.hostname;
          const path = url.pathname;
          const base = { method: req.method, host, path };

          const bodyText =
            req.body.buffer.length <= MAX_PLACEHOLDER_SCAN_BYTES ? ((await req.body.getText()) ?? '') : '';
          // Snapshot before anything is attached: this is what the agent sent.
          const sent = { method: req.method, url: req.url, ...capture(req.headers, (await req.body.getDecodedBuffer()) ?? req.body.buffer) };
          const refuse = (reason: string, credential?: string) => {
            const response = blocked(reason);
            emit(
              { ...base, action: 'blocked', reason, ...(credential ? { credential } : {}), status: 403 },
              { request: sent, response: { status: 403, ...capture(response.headers ?? {}, Buffer.from(String(response.body))) } },
            );
            return { response };
          };
          const named = findPlaceholders(req.url, headerText(req.headers), bodyText);
          const all = options.credentials();
          const match = findCredentialForHost(all, host, named[0]);

          if (!match) {
            if (named.length === 0) return; // Ordinary traffic, not ours.
            const known = all.find((c) => named.includes(c.credential.name));
            const reason = known
              ? `Credential "${known.credential.name}" may only be sent to ${known.credential.hosts.join(', ')}, not ${host}.`
              : `No credential named "${named[0]}" is configured. Ask the user to add it in Keybroker (or propose one).`;
            return refuse(reason);
          }

          const name = match.credential.name;
          if (url.protocol !== 'https:') {
            return refuse(`Refusing to send credential "${name}" over plain HTTP. Use https://${host}${path}.`, name);
          }
          const other = named.find((n) => n !== name);
          if (other) {
            return refuse(`Placeholder for "${other}" sent to ${host}, which is bound to "${name}".`, name);
          }

          const headers: Headers = { ...req.headers };
          applyAuth({ url, headers }, match.credential.auth, match.secret);
          // Uncompressed responses keep scrubbing simple and reliable.
          headers['accept-encoding'] = 'identity';

          injected.set(req.id, {
            credential: name,
            needles: secretVariants(match.credential.auth, match.secret),
            request: { ...sent, injectedAt: injectedAt(match.credential.auth) },
          });
          return { url: url.toString(), headers };
        },
        beforeResponse: async (res, req) => {
          const record = injected.get(req.id);
          if (!record) return;
          injected.delete(req.id);
          const url = new URL(req.url);
          const base = { method: req.method, host: url.hostname, path: url.pathname, credential: record.credential };

          if (res.body.buffer.length > MAX_SCRUB_BYTES) {
            const reason = 'Response too large to check for leaked secrets.';
            const response = blocked(reason);
            emit(
              { ...base, action: 'blocked', status: res.statusCode, reason },
              { request: record.request, response: { status: 403, ...capture(response.headers ?? {}, Buffer.from(String(response.body))) } },
            );
            return response;
          }
          const decoded = (await res.body.getDecodedBuffer()) ?? res.body.buffer;
          const body = scrubBuffer(decoded, record.needles);
          const headers = scrubHeaders(res.headers, record.needles);
          emit(
            { ...base, action: 'injected', status: res.statusCode, redactions: body.redactions },
            { request: record.request, response: { status: res.statusCode, ...capture(headers.headers, body.body) } },
          );

          if (body.redactions === 0 && !headers.changed) return;
          return { headers: headers.headers, body: body.body };
        },
      });

    await server.forAnyWebSocket().thenPassThrough();
    await server.start(port);
    port = server.port;
  }

  await start();

  return {
    get port() {
      return port;
    },
    get url() {
      return `http://127.0.0.1:${port}`;
    },
    async reload() {
      await server?.stop();
      await start();
    },
    async stop() {
      await server?.stop();
      server = undefined;
    },
  };
}

export { proxiedRequest, type ProxiedRequestInput, type ProxiedRequestResult } from './request.js';
export { startRelay, type RelayOptions } from './relay.js';
